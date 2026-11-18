package downloader

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/config"
	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

var (
	ErrBadState = errors.New("invalid state for this action")
	validModel  = regexp.MustCompile(`^[\w.\-]+/[\w.\-]+$`)
	validTag    = regexp.MustCompile(`^[\w.\-]+$`)
	validDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

type Stats struct {
	Active     bool    `json:"active"`
	Phase      string  `json:"phase"`
	Downloaded int64   `json:"downloadedBytes"`
	Speed      float64 `json:"speed"`
	Retries    int64   `json:"retries"`
	LastError  string  `json:"lastError"`
}

type job struct {
	id      int64
	cancel  context.CancelFunc
	pausing atomic.Bool
	done    chan struct{}
	bytes   atomic.Int64
	speed   atomic.Uint64
	retries atomic.Int64
	lastErr atomic.Value
	phase   atomic.Value
}

type Manager struct {
	store *store.Store
	reg   *registry.Client
	cfg   config.Config
	http  *http.Client

	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	jobs   map[int64]*job
	wg     sync.WaitGroup

	// External lists blobs that something outside the downloader still needs.
	External func() map[string]bool
	// Notify, when set, is told when a download finishes, fails or gets installed.
	Notify func(title, body string)
}

func (m *Manager) notify(title, body string) {
	if m.Notify != nil {
		m.Notify(title, body)
	}
}

func displayName(d *store.Download) string {
	return strings.TrimPrefix(d.Model, "library/") + ":" + d.Tag
}

func New(s *store.Store, reg *registry.Client, cfg config.Config) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
	}
	return &Manager{store: s, reg: reg, cfg: cfg, http: &http.Client{Transport: transport}, ctx: ctx, cancel: cancel, jobs: map[int64]*job{}}
}

func (m *Manager) stagingDir(id int64) string {
	return filepath.Join(m.cfg.StagingDir, fmt.Sprint(id))
}

func (m *Manager) Create(ctx context.Context, model, tag string) (*store.Download, error) {
	if !validModel.MatchString(model) || !validTag.MatchString(tag) {
		return nil, fmt.Errorf("invalid model or tag")
	}
	if d, err := m.store.FindByModelTag(ctx, model, tag); err == nil {
		if d.Status == store.StatusPaused || d.Status == store.StatusError {
			m.start(d.ID)
		}
		return d, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	raw, man, err := m.reg.Manifest(ctx, model, tag)
	if err != nil {
		return nil, err
	}
	d := &store.Download{Model: model, Tag: tag, Status: store.StatusDownloading, Manifest: raw}
	for _, l := range man.AllBlobs() {
		if !validDigest.MatchString(l.Digest) {
			return nil, fmt.Errorf("unexpected digest %q", l.Digest)
		}
		b := store.Blob{Digest: l.Digest, MediaType: l.MediaType, Size: l.Size, Segments: []store.Segment{}}
		if installer.BlobExists(m.cfg.ModelsDir, l.Digest, l.Size) {
			b.Done, b.Downloaded = true, l.Size
		}
		d.TotalBytes += l.Size
		d.Blobs = append(d.Blobs, b)
	}
	if err := m.store.CreateDownload(ctx, d); err != nil {
		return nil, err
	}
	m.start(d.ID)
	return m.store.Get(ctx, d.ID)
}

// Update downloads the registry's current version of an installed model, reusing blobs already on disk.
func (m *Manager) Update(ctx context.Context, model, tag string) (*store.Download, error) {
	if _, err := installer.LocalManifest(m.cfg.ModelsDir, m.reg.Host(), model, tag); err != nil {
		return nil, err
	}
	if d, err := m.store.FindByModelTag(ctx, model, tag); err == nil && d.Status == store.StatusInstalled {
		if err := m.store.Delete(ctx, d.ID); err != nil {
			return nil, err
		}
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	return m.Create(ctx, model, tag)
}

// KeepDigests lists blobs that unfinished downloads or other features still rely on.
func (m *Manager) KeepDigests(ctx context.Context) (map[string]bool, error) {
	keep := map[string]bool{}
	if m.External != nil {
		keep = m.External()
	}
	list, err := m.store.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, d := range list {
		if d.Status != store.StatusInstalled {
			for _, b := range d.Blobs {
				keep[b.Digest] = true
			}
		}
	}
	return keep, nil
}

func (m *Manager) ResumeInterrupted(ctx context.Context) error {
	list, err := m.store.ListByStatus(ctx, store.StatusDownloading)
	if err != nil {
		return err
	}
	for _, d := range list {
		log.Printf("resuming interrupted download %d (%s:%s)", d.ID, d.Model, d.Tag)
		m.start(d.ID)
	}
	installing, err := m.store.ListByStatus(ctx, store.StatusInstalling)
	if err != nil {
		return err
	}
	for _, d := range installing {
		_ = m.store.SetStatus(ctx, d.ID, store.StatusCompleted, "install was interrupted, please retry")
	}
	return nil
}

func (m *Manager) Pause(ctx context.Context, id int64) error {
	m.mu.Lock()
	j := m.jobs[id]
	m.mu.Unlock()
	if j == nil {
		d, err := m.store.Get(ctx, id)
		if err != nil {
			return err
		}
		if d.Status != store.StatusDownloading {
			return ErrBadState
		}
		return m.store.SetStatus(ctx, id, store.StatusPaused, "")
	}
	j.pausing.Store(true)
	j.cancel()
	<-j.done
	return nil
}

func (m *Manager) Resume(ctx context.Context, id int64) error {
	d, err := m.store.Get(ctx, id)
	if err != nil {
		return err
	}
	switch d.Status {
	case store.StatusPaused, store.StatusError, store.StatusDownloading:
		if err := m.store.SetStatus(ctx, id, store.StatusDownloading, ""); err != nil {
			return err
		}
		m.start(id)
		return nil
	}
	return ErrBadState
}

func (m *Manager) Delete(ctx context.Context, id int64) error {
	m.mu.Lock()
	j := m.jobs[id]
	m.mu.Unlock()
	if j != nil {
		j.pausing.Store(true)
		j.cancel()
		<-j.done
	}
	if err := os.RemoveAll(m.stagingDir(id)); err != nil {
		return err
	}
	return m.store.Delete(ctx, id)
}

// FilesPath returns the on-disk location of a download's files, relative to the
// models dir: the staging folder before install, the manifest file after.
func (m *Manager) FilesPath(ctx context.Context, id int64) (string, error) {
	d, err := m.store.Get(ctx, id)
	if err != nil {
		return "", err
	}
	var p string
	if d.Status == store.StatusInstalled {
		p = filepath.Join(m.cfg.ModelsDir, "manifests", m.reg.Host(), filepath.FromSlash(d.Model), d.Tag)
	} else {
		p = m.stagingDir(id)
	}
	if _, err := os.Stat(p); err != nil {
		return "", fmt.Errorf("%w: files not found on disk", ErrBadState)
	}
	return filepath.Rel(m.cfg.ModelsDir, p)
}

func (m *Manager) Install(ctx context.Context, id int64) error {
	d, err := m.store.Get(ctx, id)
	if err != nil {
		return err
	}
	if d.Status != store.StatusCompleted {
		return ErrBadState
	}
	if err := m.store.SetStatus(ctx, id, store.StatusInstalling, ""); err != nil {
		return err
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		bg := context.Background()
		old, oldErr := installer.LocalManifest(m.cfg.ModelsDir, m.reg.Host(), d.Model, d.Tag)
		if err := installer.Install(m.cfg.ModelsDir, m.stagingDir(id), m.reg.Host(), d); err != nil {
			log.Printf("install %d failed: %v", id, err)
			_ = m.store.SetStatus(bg, id, store.StatusCompleted, err.Error())
			m.notify("Install failed", displayName(d)+": "+err.Error())
			return
		}
		_ = os.RemoveAll(m.stagingDir(id))
		_ = m.store.SetStatus(bg, id, store.StatusInstalled, "")
		log.Printf("installed %s:%s", d.Model, d.Tag)
		m.notify("Model installed", displayName(d)+" is ready to use in Ollama")
		if oldErr == nil {
			if keep, err := m.KeepDigests(bg); err == nil {
				freed := installer.Prune(m.cfg.ModelsDir, old, func(dg string) bool { return keep[dg] })
				log.Printf("updated %s:%s, freed %d bytes of old files", d.Model, d.Tag, freed)
			}
		}
	}()
	return nil
}

func (m *Manager) Stats(id int64) *Stats {
	m.mu.Lock()
	j := m.jobs[id]
	m.mu.Unlock()
	if j == nil {
		return nil
	}
	s := &Stats{
		Active:     true,
		Downloaded: j.bytes.Load(),
		Speed:      math.Float64frombits(j.speed.Load()),
		Retries:    j.retries.Load(),
	}
	s.LastError, _ = j.lastErr.Load().(string)
	s.Phase, _ = j.phase.Load().(string)
	return s
}

func (m *Manager) Shutdown() {
	m.cancel()
	m.wg.Wait()
}

func (m *Manager) start(id int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.jobs[id]; ok {
		return
	}
	ctx, cancel := context.WithCancel(m.ctx)
	j := &job{id: id, cancel: cancel, done: make(chan struct{})}
	j.phase.Store("starting")
	m.jobs[id] = j
	m.wg.Add(1)
	go m.run(ctx, j)
}

func (m *Manager) run(ctx context.Context, j *job) {
	defer func() {
		m.mu.Lock()
		delete(m.jobs, j.id)
		m.mu.Unlock()
		j.cancel()
		close(j.done)
		m.wg.Done()
	}()
	bg := context.Background()
	d, err := m.store.Get(bg, j.id)
	if err != nil {
		log.Printf("download %d: %v", j.id, err)
		return
	}
	_ = m.store.SetStatus(bg, j.id, store.StatusDownloading, "")
	j.bytes.Store(d.Downloaded)
	go m.sampleSpeed(ctx, j)

	for i := range d.Blobs {
		b := &d.Blobs[i]
		if b.Done {
			continue
		}
		if err := m.downloadBlob(ctx, j, d, b); err != nil {
			if ctx.Err() != nil {
				if j.pausing.Load() {
					_ = m.store.SetStatus(bg, j.id, store.StatusPaused, "")
				}
				return
			}
			log.Printf("download %d failed: %v", j.id, err)
			_ = m.store.SetStatus(bg, j.id, store.StatusError, err.Error())
			m.notify("Download failed", displayName(d)+": "+err.Error())
			return
		}
	}
	_ = m.store.SetStatus(bg, j.id, store.StatusCompleted, "")
	log.Printf("download %d (%s:%s) completed", j.id, d.Model, d.Tag)
	_, oldErr := installer.LocalManifest(m.cfg.ModelsDir, m.reg.Host(), d.Model, d.Tag)
	settings, err := m.store.Settings(bg)
	if err != nil {
		log.Printf("read settings: %v", err)
	}
	if oldErr != nil && !settings.AutoInstall {
		m.notify("Download complete", displayName(d)+" is ready to install")
		return
	}
	if err := m.Install(bg, j.id); err != nil {
		log.Printf("auto-install %d: %v", j.id, err)
		m.notify("Install failed", displayName(d)+": "+err.Error())
	}
}

func (m *Manager) sampleSpeed(ctx context.Context, j *job) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	last := j.bytes.Load()
	ema := 0.0
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cur := j.bytes.Load()
			delta := float64(cur - last)
			if delta < 0 {
				delta = 0
			}
			last = cur
			ema = 0.3*delta + 0.7*ema
			j.speed.Store(math.Float64bits(ema))
		}
	}
}
