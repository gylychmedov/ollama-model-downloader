package cleanup

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

const host = "registry.ollama.ai"

var old = time.Now().Add(-90 * 24 * time.Hour)

func digest(c byte) string { return "sha256:" + strings.Repeat(string(c), 64) }

func write(t *testing.T, p string, data string, mtime time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(p, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func blob(dir, d string) string { return filepath.Join(dir, "blobs", installer.BlobFileName(d)) }

func install(t *testing.T, dir, model, tag string, blobs ...string) {
	t.Helper()
	man := registry.Manifest{SchemaVersion: 2, Config: registry.Layer{Digest: blobs[0], Size: 4}}
	for _, b := range blobs[1:] {
		man.Layers = append(man.Layers, registry.Layer{MediaType: "application/vnd.ollama.image.model", Digest: b, Size: 4})
	}
	for _, b := range blobs {
		write(t, blob(dir, b), "data", old)
	}
	raw, _ := json.Marshal(man)
	p := installer.ManifestPath(dir, host, model, tag)
	write(t, p, string(raw), old)
}

func setup(t *testing.T) Input {
	dir := t.TempDir()
	staging := filepath.Join(dir, ".downloader-staging")
	install(t, dir, "library/a", "1b", digest('1'), digest('2'))
	install(t, dir, "library/b", "2b", digest('3'), digest('2'))
	install(t, dir, "library/c", "3b", digest('4'), digest('5'))

	write(t, blob(dir, digest('6')), "orphan", old)
	write(t, blob(dir, digest('7')), "fresh", time.Now())
	write(t, blob(dir, digest('8')), "kept", old)
	write(t, blob(dir, digest('9'))+"-partial", "part", old)

	write(t, filepath.Join(staging, "99", "x"), "gone", old)
	write(t, filepath.Join(staging, "1", "x"), "paused", old)
	write(t, filepath.Join(staging, "2", "x"), "recent", old)
	for _, d := range []string{"99", "1", "2"} {
		_ = os.Chtimes(filepath.Join(staging, d), old, old)
	}

	return Input{
		ModelsDir:  dir,
		StagingDir: staging,
		Host:       host,
		Downloads: []store.Download{
			{ID: 1, Model: "library/p", Tag: "1b", Status: store.StatusPaused, UpdatedAt: old},
			{ID: 2, Model: "library/q", Tag: "1b", Status: store.StatusPaused, UpdatedAt: time.Now()},
		},
		Active:      func(int64) bool { return false },
		Keep:        map[string]bool{digest('8'): true},
		LastUsed:    map[string]time.Time{"library/b:2b": time.Now()},
		Loaded:      map[string]bool{"library/c:3b": true},
		UnusedAfter: 30 * 24 * time.Hour,
		Now:         time.Now(),
	}
}

func ids(items []Item) map[string]Item {
	out := map[string]Item{}
	for _, it := range items {
		out[it.ID] = it
	}
	return out
}

func TestScan(t *testing.T) {
	in := setup(t)
	got := ids(Scan(in))

	want := []string{
		"staging:99",
		"download:1",
		"temp:blobs/" + installer.BlobFileName(digest('9')) + "-partial",
		"blob:" + digest('6'),
		"model:library/a:1b",
	}
	for _, id := range want {
		if _, ok := got[id]; !ok {
			t.Errorf("missing %s", id)
		}
	}
	if len(got) != len(want) {
		t.Errorf("got %d items, want %d: %v", len(got), len(want), got)
	}
	if b := got["model:library/a:1b"].Bytes; b != 4 {
		t.Errorf("model a frees %d bytes, want 4 (shared blob excluded)", b)
	}
}

func TestCleanOnlyDeletesEligibleItems(t *testing.T) {
	in := setup(t)
	var removed []string
	var deleted []int64
	res := Clean(in, []string{"blob:" + digest('6'), "blob:" + digest('8'), "staging:99", "model:library/a:1b", "download:1"}, Actions{
		RemoveModel: func(model, tag string) (int64, error) {
			removed = append(removed, model+":"+tag)
			return 4, nil
		},
		DeleteDownload: func(id int64) error { deleted = append(deleted, id); return nil },
	})
	if res.Removed != 4 || res.Skipped != 1 {
		t.Fatalf("removed %d skipped %d, want 4 and 1 (errors %v)", res.Removed, res.Skipped, res.Errors)
	}
	if _, err := os.Stat(blob(in.ModelsDir, digest('6'))); err == nil {
		t.Error("orphan blob still exists")
	}
	if _, err := os.Stat(blob(in.ModelsDir, digest('8'))); err != nil {
		t.Error("kept blob was deleted")
	}
	if _, err := os.Stat(filepath.Join(in.StagingDir, "99")); err == nil {
		t.Error("orphan staging folder still exists")
	}
	if len(removed) != 1 || removed[0] != "library/a:1b" || len(deleted) != 1 || deleted[0] != 1 {
		t.Errorf("removed %v deleted %v", removed, deleted)
	}
}
