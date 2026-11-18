package installer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dagdan/ai-model-downloader/internal/registry"
)

const host = "registry.ollama.ai"

func digest(c byte) string { return "sha256:" + strings.Repeat(string(c), 64) }

func install(t *testing.T, dir, model, tag string, blobs ...string) {
	t.Helper()
	man := registry.Manifest{SchemaVersion: 2, Config: registry.Layer{Digest: blobs[0], Size: 2}}
	for _, b := range blobs[1:] {
		man.Layers = append(man.Layers, registry.Layer{MediaType: "application/vnd.ollama.image.model", Digest: b, Size: 2})
	}
	for _, b := range blobs {
		if err := os.MkdirAll(filepath.Join(dir, "blobs"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(blobPath(dir, b), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(man)
	if err := WriteManifest(ManifestPath(dir, host, model, tag), raw); err != nil {
		t.Fatal(err)
	}
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func TestRemoveKeepsSharedAndProtectedBlobs(t *testing.T) {
	dir := t.TempDir()
	install(t, dir, "library/a", "1b", digest('1'), digest('2'), digest('3'))
	install(t, dir, "library/b", "2b", digest('4'), digest('2'))

	freed, err := Remove(dir, host, "library/a", "1b", func(d string) bool { return d == digest('3') })
	if err != nil {
		t.Fatal(err)
	}
	if freed != 2 {
		t.Fatalf("freed %d, want 2", freed)
	}
	if exists(blobPath(dir, digest('1'))) {
		t.Error("unshared config blob was kept")
	}
	if !exists(blobPath(dir, digest('2'))) {
		t.Error("blob shared with library/b was deleted")
	}
	if !exists(blobPath(dir, digest('3'))) {
		t.Error("protected blob was deleted")
	}
	if exists(filepath.Join(dir, "manifests", host, "library", "a")) {
		t.Error("empty manifest dir was not pruned")
	}
	if got := Installed(dir, host); len(got) != 1 || got[0] != "library/b:2b" {
		t.Errorf("installed = %v", got)
	}
}

func TestRemoveRejectsBadNames(t *testing.T) {
	dir := t.TempDir()
	for _, c := range [][2]string{{"../x", "1"}, {"library/a", "../../x"}, {"a", "1"}} {
		if _, err := Remove(dir, host, c[0], c[1], func(string) bool { return false }); err != ErrInvalidName {
			t.Errorf("%v: err = %v", c, err)
		}
	}
	if _, err := Remove(dir, host, "library/none", "1b", func(string) bool { return false }); err != ErrNotInstalled {
		t.Errorf("missing model: err = %v", err)
	}
}
