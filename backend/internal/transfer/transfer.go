// Package transfer moves installed models between computers.
//
// A transfer package is a folder that mirrors Ollama's models dir layout:
//
//	<name>/blobs/sha256-<hex>
//	<name>/manifests/<host>/<namespace>/<model>/<tag>
//	<name>/README.txt
//
// Export builds one from an installed model (hard links, so it is instant and
// uses no extra space). Any package placed in the transfer dir is listed and
// can be installed: every blob is verified with sha256, moved into Ollama's
// store and the manifest is written. Because the layout matches Ollama's,
// a package can also be installed by hand by merging it into the models dir.
package transfer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/reveal"
)

const (
	StatusCopying    = "copying" // some blobs are missing or still being copied
	StatusReady      = "ready"
	StatusVerifying  = "verifying"
	StatusInstalling = "installing"
	StatusInstalled  = "installed" // every model in the package is already in Ollama
	StatusExporting  = "exporting"
	StatusError      = "error"
	StatusInvalid    = "invalid" // no manifest found
)

var (
	ErrNotFound = errors.New("transfer not found")
	ErrBusy     = errors.New("transfer is busy")
	ErrBadState = errors.New("transfer is not ready to install")
	ErrInvalid  = errors.New("invalid path")

	validSeg    = regexp.MustCompile(`^[\w][\w.\-]*$`)
	validModel  = regexp.MustCompile(`^[\w.\-]+/[\w.\-]+$`)
	validDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	blobName    = regexp.MustCompile(`^sha256-[0-9a-f]{64}$`)
)

type Model struct {
	Name      string `json:"name"` // namespace/model:tag
	Host      string `json:"host"`
	Size      int64  `json:"size"`
	Installed bool   `json:"installed"`
}

type Package struct {
	Name          string    `json:"name"`
	Path          string    `json:"path"` // location on the host, for display
	Models        []Model   `json:"models"`
	Status        string    `json:"status"`
	TotalBytes    int64     `json:"totalBytes"`
	PresentBytes  int64     `json:"presentBytes"`
	ProgressBytes int64     `json:"progressBytes"`
	ProgressTotal int64     `json:"progressTotal"`
	Error         string    `json:"error"`
	ModifiedAt    time.Time `json:"modifiedAt"`

	complete bool // every blob is in the package or already in Ollama's store
}

type entry struct {
	host, model, tag string
	raw              []byte
	man              registry.Manifest
}

type job struct {
	phase   string
	running bool
	err     string
	done    atomic.Int64
	total   int64
}

type Manager struct {
	modelsDir string
	dir       string // transfer dir as seen by this process
	hostDir   string // transfer dir as seen on the host (differs in Docker)
	host      string // default registry host for exports
	reveal    reveal.Client

	mu   sync.Mutex
	jobs map[string]*job
}

func New(modelsDir, hostModelsDir, host string, rv reveal.Client) *Manager {
	m := &Manager{
		modelsDir: modelsDir,
		dir:       filepath.Join(modelsDir, "transfer"),
		hostDir:   filepath.Join(hostModelsDir, "transfer"),
		host:      host,
		reveal:    rv,
		jobs:      map[string]*job{},
	}
	_ = os.MkdirAll(m.dir, 0o755)
	// Exports interrupted by a restart leave a hidden temp folder behind.
	if tmps, _ := filepath.Glob(filepath.Join(m.dir, ".*.exporting")); len(tmps) > 0 {
		for _, t := range tmps {
			_ = os.RemoveAll(t)
		}
	}
	return m
}

// Dir returns the transfer folder path on the host.
func (m *Manager) Dir() string { return m.hostDir }

// List returns every package in the transfer dir plus exports in progress.
func (m *Manager) List() []Package {
	out := []Package{}
	seen := map[string]bool{}
	entries, _ := os.ReadDir(m.dir)
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		seen[e.Name()] = true
		if p, _, err := m.load(e.Name()); err == nil {
			out = append(out, *p)
		}
	}
	m.mu.Lock()
	for name, j := range m.jobs {
		if !seen[name] && j.running {
			out = append(out, Package{Name: name, Path: filepath.Join(m.hostDir, name), Models: []Model{}, Status: j.phase,
				ProgressBytes: j.done.Load(), ProgressTotal: j.total, ModifiedAt: time.Now()})
		}
	}
	m.mu.Unlock()
	sort.Slice(out, func(i, k int) bool { return out[i].ModifiedAt.After(out[k].ModifiedAt) })
	return out
}

// ExternalDigests returns blobs that packages rely on Ollama's store for, because the package has no copy.
func (m *Manager) ExternalDigests() map[string]bool {
	out := map[string]bool{}
	entries, _ := os.ReadDir(m.dir)
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		_, list, err := m.load(e.Name())
		if err != nil {
			continue
		}
		for _, en := range list {
			for _, l := range en.man.AllBlobs() {
				if _, err := os.Stat(filepath.Join(m.dir, e.Name(), "blobs", installer.BlobFileName(l.Digest))); err != nil {
					out[l.Digest] = true
				}
			}
		}
	}
	return out
}

func (m *Manager) load(name string) (*Package, []entry, error) {
	if !validSeg.MatchString(name) {
		return nil, nil, ErrNotFound
	}
	root := filepath.Join(m.dir, name)
	fi, err := os.Stat(root)
	if err != nil || !fi.IsDir() {
		return nil, nil, ErrNotFound
	}
	p := &Package{Name: name, Path: filepath.Join(m.hostDir, name), Models: []Model{}, ModifiedAt: fi.ModTime(), complete: true}

	var entries []entry
	var parseErr string
	matches, _ := filepath.Glob(filepath.Join(root, "manifests", "*", "*", "*", "*"))
	for _, f := range matches {
		rel, _ := filepath.Rel(filepath.Join(root, "manifests"), f)
		parts := strings.Split(filepath.ToSlash(rel), "/")
		if !allValid(parts) || strings.HasSuffix(f, ".tmp") || strings.HasSuffix(f, ".part") {
			continue
		}
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var man registry.Manifest
		if err := json.Unmarshal(raw, &man); err != nil || !digestsValid(man) {
			parseErr = fmt.Sprintf("manifest %s is damaged", strings.Join(parts[1:3], "/")+":"+parts[3])
			continue
		}
		entries = append(entries, entry{host: parts[0], model: parts[1] + "/" + parts[2], tag: parts[3], raw: raw, man: man})
	}

	counted := map[string]bool{}
	allInstalled := len(entries) > 0
	for _, e := range entries {
		mod := Model{Name: e.model + ":" + e.tag, Host: e.host, Installed: true}
		if _, err := os.Stat(installer.ManifestPath(m.modelsDir, e.host, e.model, e.tag)); err != nil {
			mod.Installed = false
		}
		for _, l := range e.man.AllBlobs() {
			mod.Size += l.Size
			inStore := installer.BlobExists(m.modelsDir, l.Digest, l.Size)
			if !inStore {
				mod.Installed = false
			}
			if counted[l.Digest] {
				continue
			}
			counted[l.Digest] = true
			p.TotalBytes += l.Size
			if inStore {
				p.PresentBytes += l.Size
			} else if fi, err := os.Stat(filepath.Join(root, "blobs", installer.BlobFileName(l.Digest))); err == nil {
				p.PresentBytes += min(fi.Size(), l.Size)
				p.complete = p.complete && fi.Size() >= l.Size // manifests can understate sizes; install checks the hash
			} else {
				p.complete = false
			}
		}
		allInstalled = allInstalled && mod.Installed
		p.Models = append(p.Models, mod)
	}

	switch {
	case len(entries) == 0:
		p.Status = StatusInvalid
		p.Error = "No Ollama model found in this folder. It should contain the blobs and manifests folders."
		if parseErr != "" {
			p.Error = parseErr
		}
	case allInstalled:
		p.Status = StatusInstalled
	case p.complete:
		p.Status = StatusReady
	default:
		p.Status = StatusCopying
	}

	m.mu.Lock()
	if j := m.jobs[name]; j != nil {
		if j.running {
			p.Status = j.phase
			p.ProgressBytes, p.ProgressTotal = j.done.Load(), j.total
		} else if j.err != "" && p.Status != StatusInstalled {
			p.Status, p.Error = StatusError, j.err
		}
	}
	m.mu.Unlock()
	return p, entries, nil
}

// begin reserves name for a background job.
func (m *Manager) begin(name, phase string) (*job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if j := m.jobs[name]; j != nil && j.running {
		return nil, ErrBusy
	}
	j := &job{phase: phase, running: true}
	m.jobs[name] = j
	return j, nil
}

func (m *Manager) finish(name string, j *job, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j.running = false
	if err == nil {
		if m.jobs[name] == j {
			delete(m.jobs, name)
		}
		return
	}
	j.err = err.Error()
}

func (m *Manager) setPhase(j *job, phase string, total int64) {
	m.mu.Lock()
	j.phase, j.total = phase, total
	j.done.Store(0)
	m.mu.Unlock()
}

// Install verifies the package's blobs and installs its models into Ollama.
// On success the package folder is removed (its blobs were moved, not copied).
func (m *Manager) Install(name string) error {
	p, entries, err := m.load(name)
	if err != nil {
		return err
	}
	if (p.Status != StatusReady && p.Status != StatusError) || !p.complete {
		return ErrBadState
	}
	j, err := m.begin(name, StatusVerifying)
	if err != nil {
		return err
	}
	go func() {
		err := m.install(name, j, entries)
		if err != nil {
			log.Printf("transfer install %s failed: %v", name, err)
		} else {
			log.Printf("transfer %s installed", name)
		}
		m.finish(name, j, err)
	}()
	return nil
}

func (m *Manager) install(name string, j *job, entries []entry) error {
	root := filepath.Join(m.dir, name)
	var need []registry.Layer
	var total int64
	seen := map[string]bool{}
	for _, e := range entries {
		for _, l := range e.man.AllBlobs() {
			if seen[l.Digest] || installer.BlobExists(m.modelsDir, l.Digest, l.Size) {
				continue
			}
			seen[l.Digest] = true
			need = append(need, l)
			total += l.Size
		}
	}

	m.setPhase(j, StatusVerifying, total)
	for _, l := range need {
		if err := verify(filepath.Join(root, "blobs", installer.BlobFileName(l.Digest)), l, &j.done); err != nil {
			return err
		}
	}

	m.setPhase(j, StatusInstalling, total)
	blobsDir := filepath.Join(m.modelsDir, "blobs")
	if err := os.MkdirAll(blobsDir, 0o755); err != nil {
		return err
	}
	for _, l := range need {
		file := installer.BlobFileName(l.Digest)
		if !installer.BlobExists(m.modelsDir, l.Digest, l.Size) {
			if err := installer.MoveFile(filepath.Join(root, "blobs", file), filepath.Join(blobsDir, file)); err != nil {
				return fmt.Errorf("install blob %s: %w", l.Digest, err)
			}
		}
		j.done.Add(l.Size)
	}
	for _, e := range entries {
		if err := installer.WriteManifest(installer.ManifestPath(m.modelsDir, e.host, e.model, e.tag), e.raw); err != nil {
			return err
		}
	}
	return os.RemoveAll(root)
}

func verify(path string, l registry.Layer, progress *atomic.Int64) error {
	short := strings.TrimPrefix(l.Digest, "sha256:")[:12]
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("blob %s is missing", short)
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, &countingReader{r: f, n: progress}); err != nil {
		return fmt.Errorf("read blob %s: %w", short, err)
	}
	if "sha256:"+hex.EncodeToString(h.Sum(nil)) != l.Digest {
		return fmt.Errorf("blob %s is corrupted (checksum mismatch). Copy the folder again", short)
	}
	return nil
}

// ExportName is the folder name used for an exported model.
func ExportName(model, tag string) string {
	return strings.ReplaceAll(strings.TrimPrefix(model, "library/"), "/", "-") + "-" + tag
}

// Export builds a transfer package for an installed model in the background
// and reveals it in the file manager when ready. It returns the folder name.
func (m *Manager) Export(model, tag string) (string, error) {
	if !validModel.MatchString(model) || !validSeg.MatchString(tag) {
		return "", ErrInvalid
	}
	raw, err := os.ReadFile(installer.ManifestPath(m.modelsDir, m.host, model, tag))
	if err != nil {
		return "", ErrNotFound
	}
	var man registry.Manifest
	if err := json.Unmarshal(raw, &man); err != nil || !digestsValid(man) {
		return "", fmt.Errorf("manifest for %s:%s is damaged", model, tag)
	}
	name := ExportName(model, tag)
	j, err := m.begin(name, StatusExporting)
	if err != nil {
		return "", err
	}
	go func() {
		err := m.export(name, j, model, tag, raw, man)
		if err != nil {
			log.Printf("export %s failed: %v", name, err)
		}
		m.finish(name, j, err)
		if err == nil {
			if err := m.Reveal(context.Background(), name); err != nil {
				log.Printf("reveal export %s: %v", name, err)
			}
		}
	}()
	return name, nil
}

func (m *Manager) export(name string, j *job, model, tag string, raw []byte, man registry.Manifest) error {
	var total int64
	for _, l := range man.AllBlobs() {
		total += l.Size
	}
	m.setPhase(j, StatusExporting, total)

	tmp := filepath.Join(m.dir, "."+name+".exporting")
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(filepath.Join(tmp, "blobs"), 0o755); err != nil {
		return err
	}
	for _, l := range man.AllBlobs() {
		file := installer.BlobFileName(l.Digest)
		src := filepath.Join(m.modelsDir, "blobs", file)
		dst := filepath.Join(tmp, "blobs", file)
		if _, err := os.Stat(dst); err == nil {
			continue // config and a layer can share a digest
		}
		if !installer.BlobExists(m.modelsDir, l.Digest, l.Size) {
			_ = os.RemoveAll(tmp)
			return fmt.Errorf("blob %s is missing from Ollama's store", l.Digest)
		}
		// A hard link is instant and takes no extra space; copy if links aren't supported.
		if err := os.Link(src, dst); err != nil {
			if err := copyFile(src, dst, &j.done); err != nil {
				_ = os.RemoveAll(tmp)
				return err
			}
			continue
		}
		j.done.Add(l.Size)
	}
	if err := installer.WriteManifest(installer.ManifestPath(tmp, m.host, model, tag), raw); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	_ = os.WriteFile(filepath.Join(tmp, "README.txt"), []byte(readme(model, tag, total)), 0o644)

	final := filepath.Join(m.dir, name)
	if err := os.RemoveAll(final); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

func readme(model, tag string, size int64) string {
	run := strings.TrimPrefix(model, "library/") + ":" + tag
	return fmt.Sprintf(`Ollama model: %s
Size: %.2f GB

This folder holds a complete Ollama model. Copy the whole folder to the other
computer (USB drive, network share, ...), then install it in one of these ways.

With Ollama Downloader
  Put the folder into the "transfer" folder inside the Ollama models folder
  (default: ~/.ollama/models/transfer). It shows up on the Downloads page
  with an Install button. Or click "Choose folder..." on the Downloads page
  and pick this folder wherever it is.

Manually (no app needed)
  macOS / Linux, in a terminal inside this folder:
      cp -R blobs manifests ~/.ollama/models/
  Windows: copy the "blobs" and "manifests" folders into
      %%USERPROFILE%%\.ollama\models
  and merge them with the existing folders.

Then run:
      ollama run %s
`, model+":"+tag, float64(size)/1e9, run)
}

// Delete removes a package folder from the transfer dir.
func (m *Manager) Delete(name string) error {
	if !validSeg.MatchString(name) {
		return ErrNotFound
	}
	m.mu.Lock()
	if j := m.jobs[name]; j != nil {
		if j.running {
			m.mu.Unlock()
			return ErrBusy
		}
		delete(m.jobs, name)
	}
	m.mu.Unlock()
	return os.RemoveAll(filepath.Join(m.dir, name))
}

// Reveal selects the package folder in the file manager.
func (m *Manager) Reveal(ctx context.Context, name string) error {
	if !validSeg.MatchString(name) {
		return ErrNotFound
	}
	if _, err := os.Stat(filepath.Join(m.dir, name)); err != nil {
		return ErrNotFound
	}
	return m.reveal.Show(ctx, filepath.Join("transfer", name), true)
}

// OpenDir opens the transfer folder itself in the file manager.
func (m *Manager) OpenDir(ctx context.Context) error {
	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return err
	}
	return m.reveal.Show(ctx, "transfer", false)
}

// Upload writes one file of a package sent from the browser (used when the
// package sits somewhere the backend can't read, like the user's Desktop).
// rel is the path inside the package: blobs/<file>, manifests/<host>/<ns>/<model>/<tag> or README.txt.
func (m *Manager) Upload(name, rel string, size int64, body io.Reader) error {
	if !validSeg.MatchString(name) {
		return ErrInvalid
	}
	parts := strings.Split(rel, "/")
	switch {
	case len(parts) == 2 && parts[0] == "blobs" && blobName.MatchString(parts[1]):
	case len(parts) == 5 && parts[0] == "manifests" && allValid(parts[1:]) && !strings.HasSuffix(rel, ".part"):
	case rel == "README.txt":
	default:
		return ErrInvalid
	}
	m.mu.Lock()
	busy := m.jobs[name] != nil && m.jobs[name].running
	m.mu.Unlock()
	if busy {
		return ErrBusy
	}

	dst := filepath.Join(m.dir, name, filepath.FromSlash(rel))
	if fi, err := os.Stat(dst); err == nil && parts[0] == "blobs" && size >= 0 && fi.Size() == size {
		_, _ = io.Copy(io.Discard, body) // already there; install verifies the checksum
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	n, err := io.Copy(f, body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && size >= 0 && n != size {
		err = fmt.Errorf("upload incomplete: got %d of %d bytes", n, size)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func allValid(parts []string) bool {
	for _, p := range parts {
		if !validSeg.MatchString(p) {
			return false
		}
	}
	return true
}

func digestsValid(man registry.Manifest) bool {
	for _, l := range man.AllBlobs() {
		if !validDigest.MatchString(l.Digest) || l.Size < 0 {
			return false
		}
	}
	return len(man.Layers) > 0
}

func copyFile(src, dst string, progress *atomic.Int64) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, &countingReader{r: in, n: progress}); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

type countingReader struct {
	r io.Reader
	n *atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n.Add(int64(n))
	return n, err
}
