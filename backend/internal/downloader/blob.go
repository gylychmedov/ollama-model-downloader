package downloader

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

const (
	minSegmentSize = 64 << 20
	stallTimeout   = 45 * time.Second
	saveInterval   = 2 * time.Second
	maxBackoff     = 30 * time.Second
)

type fatalError struct{ error }

func splitSegments(size int64, conns int) []store.Segment {
	n := int64(conns)
	if size/minSegmentSize < n {
		n = max(size/minSegmentSize, 1)
	}
	segs := make([]store.Segment, 0, n)
	chunk := size / n
	for i := int64(0); i < n; i++ {
		start := i * chunk
		end := start + chunk - 1
		if i == n-1 {
			end = size - 1
		}
		segs = append(segs, store.Segment{Start: start, End: end})
	}
	return segs
}

func (m *Manager) downloadBlob(ctx context.Context, j *job, d *store.Download, b *store.Blob) error {
	dir := m.stagingDir(d.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, installer.BlobFileName(b.Digest))
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return err
	}
	if len(b.Segments) == 0 || fi.Size() != b.Size {
		if fi.Size() != b.Size && b.Downloaded > 0 {
			j.bytes.Add(-b.Downloaded)
		}
		b.Segments = splitSegments(b.Size, m.cfg.Connections)
		b.Downloaded = 0
		if err := f.Truncate(b.Size); err != nil {
			return err
		}
	}

	if b.Size > 0 {
		if err := m.fetchSegments(ctx, j, d.Model, b, f); err != nil {
			return err
		}
	}

	j.phase.Store("verifying")
	sum, err := hashFile(ctx, f)
	if err != nil {
		return err
	}
	if "sha256:"+sum != b.Digest {
		j.bytes.Add(-b.Downloaded)
		b.Segments, b.Downloaded = nil, 0
		_ = m.store.SaveBlobProgress(context.Background(), b)
		return fmt.Errorf("checksum mismatch for %s, blob will be re-downloaded on resume", b.Digest)
	}
	b.Done = true
	return m.store.SaveBlobProgress(context.Background(), b)
}

func (m *Manager) fetchSegments(ctx context.Context, j *job, model string, b *store.Blob, f *os.File) error {
	j.phase.Store("downloading")
	url := m.reg.BlobURL(model, b.Digest)
	progress := make([]atomic.Int64, len(b.Segments))
	for i, s := range b.Segments {
		progress[i].Store(s.Done)
	}

	segCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	var firstErr error
	var errOnce sync.Once
	for i := range b.Segments {
		seg := b.Segments[i]
		if seg.Start+progress[i].Load() > seg.End {
			continue
		}
		wg.Add(1)
		go func(p *atomic.Int64) {
			defer wg.Done()
			if err := m.fetchSegment(segCtx, j, url, f, seg, p); err != nil && segCtx.Err() == nil {
				errOnce.Do(func() { firstErr = err })
				cancel()
			}
		}(&progress[i])
	}

	save := func() {
		_ = f.Sync()
		var total int64
		for i := range b.Segments {
			b.Segments[i].Done = progress[i].Load()
			total += b.Segments[i].Done
		}
		b.Downloaded = total
		_ = m.store.SaveBlobProgress(context.Background(), b)
	}

	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()
	ticker := time.NewTicker(saveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			save()
		case <-finished:
			save()
			if firstErr != nil {
				return firstErr
			}
			return ctx.Err()
		}
	}
}

func (m *Manager) fetchSegment(ctx context.Context, j *job, url string, f *os.File, seg store.Segment, done *atomic.Int64) error {
	backoff := time.Second
	for {
		start := seg.Start + done.Load()
		if start > seg.End {
			return nil
		}
		before := done.Load()
		err := m.fetchRange(ctx, j, url, f, start, seg.End, done)
		if err == nil {
			continue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var fe fatalError
		if errors.As(err, &fe) {
			return fe.error
		}
		j.retries.Add(1)
		j.lastErr.Store(err.Error())
		if done.Load() > before {
			backoff = time.Second
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, maxBackoff)
	}
}

func (m *Manager) fetchRange(ctx context.Context, j *job, url string, f *os.File, start, end int64, done *atomic.Int64) error {
	reqCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return fatalError{err}
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	resp, err := m.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusPartialContent:
	case resp.StatusCode == http.StatusOK && start == 0:
	case resp.StatusCode == http.StatusOK:
		return fmt.Errorf("server ignored range request")
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return fmt.Errorf("server returned %s", resp.Status)
	default:
		return fatalError{fmt.Errorf("blob request failed: %s", resp.Status)}
	}

	var stalled atomic.Bool
	watchdog := time.AfterFunc(stallTimeout, func() { stalled.Store(true); cancel() })
	defer watchdog.Stop()

	buf := make([]byte, 256<<10)
	off := start
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			watchdog.Reset(stallTimeout)
			if remaining := end - off + 1; int64(n) > remaining {
				n = int(remaining)
			}
			if _, werr := f.WriteAt(buf[:n], off); werr != nil {
				return fatalError{werr}
			}
			off += int64(n)
			done.Add(int64(n))
			j.bytes.Add(int64(n))
			if off > end {
				return nil
			}
		}
		if rerr != nil {
			if stalled.Load() {
				return fmt.Errorf("connection stalled for %s", stallTimeout)
			}
			if errors.Is(rerr, io.EOF) {
				return fmt.Errorf("connection closed early at byte %d", off)
			}
			return rerr
		}
	}
}

func hashFile(ctx context.Context, f *os.File) (string, error) {
	h := sha256.New()
	r := io.NewSectionReader(f, 0, 1<<62)
	buf := make([]byte, 4<<20)
	for {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		n, err := r.Read(buf)
		h.Write(buf[:n])
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
	}
	return strings.ToLower(hex.EncodeToString(h.Sum(nil))), nil
}
