package installer

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"github.com/dagdan/ai-model-downloader/internal/store"
)

func BlobFileName(digest string) string {
	return strings.Replace(digest, ":", "-", 1)
}

func BlobExists(modelsDir, digest string, size int64) bool {
	fi, err := os.Stat(filepath.Join(modelsDir, "blobs", BlobFileName(digest)))
	return err == nil && fi.Size() == size
}

func Install(modelsDir, stagingDir, host string, d *store.Download) error {
	blobsDir := filepath.Join(modelsDir, "blobs")
	if err := os.MkdirAll(blobsDir, 0o755); err != nil {
		return err
	}
	for _, b := range d.Blobs {
		if BlobExists(modelsDir, b.Digest, b.Size) {
			continue
		}
		src := filepath.Join(stagingDir, BlobFileName(b.Digest))
		dst := filepath.Join(blobsDir, BlobFileName(b.Digest))
		if err := moveFile(src, dst); err != nil {
			return fmt.Errorf("install blob %s: %w", b.Digest, err)
		}
	}
	manifestPath := filepath.Join(modelsDir, "manifests", host, filepath.FromSlash(d.Model), d.Tag)
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		return err
	}
	tmp := manifestPath + ".tmp"
	if err := os.WriteFile(tmp, []byte(d.Manifest), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, manifestPath)
}

func Installed(modelsDir, host string) []string {
	root := filepath.Join(modelsDir, "manifests", host)
	out := []string{}
	matches, _ := filepath.Glob(filepath.Join(root, "*", "*", "*"))
	for _, m := range matches {
		rel, err := filepath.Rel(root, m)
		if err != nil || strings.HasSuffix(m, ".tmp") {
			continue
		}
		parts := strings.Split(filepath.ToSlash(rel), "/")
		out = append(out, parts[0]+"/"+parts[1]+":"+parts[2])
	}
	sort.Strings(out)
	return out
}

func moveFile(src, dst string) error {
	err := os.Rename(src, dst)
	if err == nil || !errors.Is(err, syscall.EXDEV) {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".partial-install"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		return err
	}
	return os.Remove(src)
}
