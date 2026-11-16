package installer

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

func BlobFileName(digest string) string {
	return strings.Replace(digest, ":", "-", 1)
}

func BlobExists(modelsDir, digest string, size int64) bool {
	fi, err := os.Stat(filepath.Join(modelsDir, "blobs", BlobFileName(digest)))
	// >= because manifests can understate a blob's size; files in the store are complete.
	return err == nil && fi.Size() >= size
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
		if err := MoveFile(src, dst); err != nil {
			return fmt.Errorf("install blob %s: %w", b.Digest, err)
		}
	}
	return WriteManifest(ManifestPath(modelsDir, host, d.Model, d.Tag), []byte(d.Manifest))
}

func ManifestPath(modelsDir, host, model, tag string) string {
	return filepath.Join(modelsDir, "manifests", host, filepath.FromSlash(model), tag)
}

// WriteManifest atomically writes a manifest file, creating parent dirs.
func WriteManifest(path string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

type Model struct {
	Name       string    `json:"name"`
	Model      string    `json:"model"`
	Tag        string    `json:"tag"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

// InstalledModels lists installed models with their total size on disk.
func InstalledModels(modelsDir, host string) []Model {
	out := []Model{}
	for _, name := range Installed(modelsDir, host) {
		model, tag, _ := strings.Cut(name, ":")
		p := ManifestPath(modelsDir, host, model, tag)
		m := Model{Name: name, Model: model, Tag: tag}
		if fi, err := os.Stat(p); err == nil {
			m.ModifiedAt = fi.ModTime()
		}
		if raw, err := os.ReadFile(p); err == nil {
			var man registry.Manifest
			if json.Unmarshal(raw, &man) == nil {
				for _, l := range man.AllBlobs() {
					m.Size += l.Size
				}
			}
		}
		out = append(out, m)
	}
	return out
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

// MoveFile renames src to dst, falling back to copy+delete across filesystems.
func MoveFile(src, dst string) error {
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
