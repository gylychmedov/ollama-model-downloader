package transfer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/reveal"
)

func noReveal() reveal.Client { return reveal.Client{HelperURL: "http://127.0.0.1:1"} }

const host = "registry.ollama.ai"

// installModel puts a fake model into an Ollama models dir.
func installModel(t *testing.T, dir, model, tag string, blobs ...string) {
	t.Helper()
	var layers []registry.Layer
	for _, b := range blobs {
		sum := sha256.Sum256([]byte(b))
		l := registry.Layer{MediaType: "application/octet-stream", Digest: "sha256:" + hex.EncodeToString(sum[:]), Size: int64(len(b))}
		layers = append(layers, l)
		p := filepath.Join(dir, "blobs", installer.BlobFileName(l.Digest))
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(b), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(registry.Manifest{SchemaVersion: 2, Config: layers[0], Layers: layers[1:]})
	if err := installer.WriteManifest(installer.ManifestPath(dir, host, model, tag), raw); err != nil {
		t.Fatal(err)
	}
}

func waitIdle(t *testing.T, m *Manager, name string) Package {
	t.Helper()
	for range 200 {
		for _, p := range m.List() {
			if p.Name == name && p.Status != StatusExporting && p.Status != StatusVerifying && p.Status != StatusInstalling {
				return p
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s never settled: %+v", name, m.List())
	return Package{}
}

func TestExportThenInstallOnAnotherComputer(t *testing.T) {
	pc1, pc2 := t.TempDir(), t.TempDir()
	installModel(t, pc1, "library/gemma3", "27b", "config", "weights-weights-weights")
	installModel(t, pc2, "library/other", "1b", "config", "other") // shares the config blob

	m1 := New(pc1, pc1, host, noReveal())
	name, err := m1.Export("library/gemma3", "27b")
	if err != nil || name != "gemma3-27b" {
		t.Fatalf("export: %q %v", name, err)
	}
	if p := waitIdle(t, m1, name); p.Status != StatusInstalled {
		t.Fatalf("export on source should read as installed, got %+v", p)
	}
	readme, _ := os.ReadFile(filepath.Join(pc1, "transfer", name, "README.txt"))
	if !strings.Contains(string(readme), "ollama run gemma3:27b") {
		t.Fatalf("readme: %s", readme)
	}

	// "USB stick": copy the folder into computer 2's transfer dir.
	m2 := New(pc2, "/Users/me/.ollama/models", host, noReveal())
	if out, err := exec.Command("cp", "-R", filepath.Join(pc1, "transfer", name), filepath.Join(pc2, "transfer")+"/").CombinedOutput(); err != nil {
		t.Fatalf("cp: %v %s", err, out)
	}
	p := waitIdle(t, m2, name)
	if p.Status != StatusReady || len(p.Models) != 1 || p.Models[0].Name != "library/gemma3:27b" || p.Path != "/Users/me/.ollama/models/transfer/gemma3-27b" {
		t.Fatalf("unexpected package: %+v", p)
	}
	if err := m2.Install(name); err != nil {
		t.Fatal(err)
	}
	waitIdle2(t, m2, name)
	if got := installer.Installed(pc2, host); strings.Join(got, ",") != "library/gemma3:27b,library/other:1b" {
		t.Fatalf("installed: %v", got)
	}
	if _, err := os.Stat(filepath.Join(pc2, "transfer", name)); !os.IsNotExist(err) {
		t.Fatalf("package folder should be removed after install")
	}
}

// waitIdle2 waits until the package disappears (installed and cleaned up).
func waitIdle2(t *testing.T, m *Manager, name string) {
	t.Helper()
	for range 200 {
		found := false
		for _, p := range m.List() {
			if p.Name == name {
				found = true
				if p.Status == StatusError {
					t.Fatalf("install failed: %s", p.Error)
				}
			}
		}
		if !found {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("install never finished")
}

func TestCorruptBlobIsRejected(t *testing.T) {
	pc1, pc2 := t.TempDir(), t.TempDir()
	installModel(t, pc1, "user/tiny", "latest", "cfg", "abcdef")
	m1 := New(pc1, pc1, host, noReveal())
	name, _ := m1.Export("user/tiny", "latest")
	waitIdle(t, m1, name)

	m2 := New(pc2, pc2, host, noReveal())
	dst := filepath.Join(pc2, "transfer", name)
	if out, err := exec.Command("cp", "-R", filepath.Join(pc1, "transfer", name), filepath.Join(pc2, "transfer")+"/").CombinedOutput(); err != nil {
		t.Fatalf("cp: %v %s", err, out)
	}
	sum := sha256.Sum256([]byte("abcdef"))
	if err := os.WriteFile(filepath.Join(dst, "blobs", "sha256-"+hex.EncodeToString(sum[:])), []byte("abcdeX"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := m2.Install(name); err != nil {
		t.Fatal(err)
	}
	p := waitIdle(t, m2, name)
	if p.Status != StatusError || !strings.Contains(p.Error, "corrupted") {
		t.Fatalf("want checksum error, got %+v", p)
	}
	if len(installer.Installed(pc2, host)) != 0 {
		t.Fatal("corrupt model must not be installed")
	}
}

func TestIncompleteCopyAndUploadValidation(t *testing.T) {
	pc1 := t.TempDir()
	installModel(t, pc1, "library/m", "1b", "c", "0123456789")
	m := New(pc1, pc1, host, noReveal())
	name, _ := m.Export("library/m", "1b")
	waitIdle(t, m, name)

	// Simulate a copy in progress on another computer via the upload API.
	pc2 := t.TempDir()
	m2 := New(pc2, pc2, host, noReveal())
	src := filepath.Join(pc1, "transfer", name)
	man, _ := filepath.Glob(filepath.Join(src, "manifests", "*", "*", "*", "*"))
	rel, _ := filepath.Rel(src, man[0])
	f, _ := os.Open(man[0])
	if err := m2.Upload(name, filepath.ToSlash(rel), -1, f); err != nil {
		t.Fatal(err)
	}
	if p := waitIdle(t, m2, name); p.Status != StatusCopying {
		t.Fatalf("want copying, got %+v", p)
	}
	if err := m2.Install(name); err != ErrBadState {
		t.Fatalf("install of incomplete package: %v", err)
	}
	blobs, _ := os.ReadDir(filepath.Join(src, "blobs"))
	for _, b := range blobs {
		f, _ := os.Open(filepath.Join(src, "blobs", b.Name()))
		fi, _ := f.Stat()
		if err := m2.Upload(name, "blobs/"+b.Name(), fi.Size(), f); err != nil {
			t.Fatal(err)
		}
	}
	if p := waitIdle(t, m2, name); p.Status != StatusReady {
		t.Fatalf("want ready, got %+v", p)
	}

	for _, bad := range []string{"../x", "blobs/../../etc", "manifests/a/b/c", "blobs/sha256-zz", "other.txt"} {
		if err := m2.Upload(name, bad, 0, strings.NewReader("")); err != ErrInvalid {
			t.Errorf("upload %q: want ErrInvalid, got %v", bad, err)
		}
	}
	if err := m2.Upload("..", "README.txt", 0, strings.NewReader("")); err != ErrInvalid {
		t.Errorf("bad package name accepted: %v", err)
	}
}

// Some registry manifests understate a blob's size (qwen3-coder's config says
// 539 bytes, the blob is 542). The hash decides, not the declared size.
func TestUnderstatedBlobSize(t *testing.T) {
	pc1, pc2 := t.TempDir(), t.TempDir()
	installModel(t, pc1, "library/q", "latest", "config-542", "weights")
	mp := installer.ManifestPath(pc1, host, "library/q", "latest")
	raw, _ := os.ReadFile(mp)
	var man registry.Manifest
	_ = json.Unmarshal(raw, &man)
	man.Config.Size -= 3
	raw, _ = json.Marshal(man)
	_ = installer.WriteManifest(mp, raw)

	m1 := New(pc1, pc1, host, noReveal())
	name, err := m1.Export("library/q", "latest")
	if err != nil {
		t.Fatal(err)
	}
	waitIdle(t, m1, name)
	m2 := New(pc2, pc2, host, noReveal())
	if out, err := exec.Command("cp", "-R", filepath.Join(pc1, "transfer", name), filepath.Join(pc2, "transfer")+"/").CombinedOutput(); err != nil {
		t.Fatalf("cp: %v %s", err, out)
	}
	if p := waitIdle(t, m2, name); p.Status != StatusReady {
		t.Fatalf("want ready, got %+v", p)
	}
	if err := m2.Install(name); err != nil {
		t.Fatal(err)
	}
	waitIdle2(t, m2, name)
}
