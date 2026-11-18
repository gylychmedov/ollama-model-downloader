package installer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/dagdan/ai-model-downloader/internal/gguf"
	"github.com/dagdan/ai-model-downloader/internal/registry"
)

var (
	ErrNotInstalled = errors.New("model is not installed")
	ErrInvalidName  = errors.New("invalid model or tag")

	validModel = regexp.MustCompile(`^\w[\w.\-]*/\w[\w.\-]*$`)
	validTag   = regexp.MustCompile(`^[\w][\w.\-]*$`)
)

type modelConfig struct {
	ModelFormat   string   `json:"model_format"`
	ModelFamily   string   `json:"model_family"`
	ModelFamilies []string `json:"model_families"`
	ModelType     string   `json:"model_type"`
	FileType      string   `json:"file_type"`
	Renderer      string   `json:"renderer"`
	Parser        string   `json:"parser"`
}

func blobPath(modelsDir, digest string) string {
	return filepath.Join(modelsDir, "blobs", BlobFileName(digest))
}

func readManifest(path string) (registry.Manifest, []byte, error) {
	var man registry.Manifest
	raw, err := os.ReadFile(path)
	if err != nil {
		return man, nil, err
	}
	return man, raw, json.Unmarshal(raw, &man)
}

func readConfig(modelsDir string, man registry.Manifest) modelConfig {
	var c modelConfig
	if man.Config.Size > 1<<20 {
		return c
	}
	if raw, err := os.ReadFile(blobPath(modelsDir, man.Config.Digest)); err == nil {
		_ = json.Unmarshal(raw, &c)
	}
	return c
}

func (m *Model) applyConfig(c modelConfig) {
	m.Format, m.Family, m.ParameterSize, m.Quantization = c.ModelFormat, c.ModelFamily, c.ModelType, c.FileType
}

func uniqueBlobs(man registry.Manifest) []registry.Layer {
	seen := map[string]bool{}
	out := []registry.Layer{}
	for _, l := range man.AllBlobs() {
		if !seen[l.Digest] {
			seen[l.Digest] = true
			out = append(out, l)
		}
	}
	return out
}

// BlobRefs counts how many manifests (across all registry hosts) reference each blob.
func BlobRefs(modelsDir string) map[string]int {
	refs := map[string]int{}
	_ = filepath.WalkDir(filepath.Join(modelsDir, "manifests"), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasSuffix(p, ".tmp") {
			return nil
		}
		man, _, err := readManifest(p)
		if err != nil {
			return nil
		}
		for _, l := range uniqueBlobs(man) {
			refs[l.Digest]++
		}
		return nil
	})
	return refs
}

// UniqueBytes is the disk space taken by every blob referenced from any manifest, counted once.
func UniqueBytes(modelsDir string) int64 {
	var total int64
	for digest := range BlobRefs(modelsDir) {
		if fi, err := os.Stat(blobPath(modelsDir, digest)); err == nil {
			total += fi.Size()
		}
	}
	return total
}

// Remove deletes an installed model's manifest and every blob no other model
// uses. Blobs for which keep returns true stay. It returns the bytes deleted.
func Remove(modelsDir, host, model, tag string, keep func(digest string) bool) (int64, error) {
	if !validModel.MatchString(model) || !validTag.MatchString(tag) {
		return 0, ErrInvalidName
	}
	p := ManifestPath(modelsDir, host, model, tag)
	man, _, err := readManifest(p)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, ErrNotInstalled
	}
	if err != nil {
		return 0, err
	}
	if err := os.Remove(p); err != nil {
		return 0, err
	}
	pruneEmptyDirs(filepath.Dir(p), filepath.Join(modelsDir, "manifests"))

	refs := BlobRefs(modelsDir)
	var freed int64
	for _, l := range uniqueBlobs(man) {
		if refs[l.Digest] > 0 || keep(l.Digest) {
			continue
		}
		bp := blobPath(modelsDir, l.Digest)
		fi, err := os.Stat(bp)
		if err != nil {
			continue
		}
		if os.Remove(bp) == nil {
			freed += fi.Size()
		}
	}
	return freed, nil
}

func pruneEmptyDirs(dir, stop string) {
	for dir != stop && strings.HasPrefix(dir, stop) {
		if os.Remove(dir) != nil {
			return
		}
		dir = filepath.Dir(dir)
	}
}

type Layer struct {
	Kind      string `json:"kind"`
	MediaType string `json:"mediaType"`
	Digest    string `json:"digest"`
	Size      int64  `json:"size"`
	Shared    bool   `json:"shared"`
}

type Arch struct {
	Architecture    string `json:"architecture"`
	Name            string `json:"name"`
	Basename        string `json:"basename"`
	SizeLabel       string `json:"sizeLabel"`
	License         string `json:"license"`
	ParameterCount  int64  `json:"parameterCount"`
	ContextLength   int64  `json:"contextLength"`
	EmbeddingLength int64  `json:"embeddingLength"`
	BlockCount      int64  `json:"blockCount"`
	HeadCount       int64  `json:"headCount"`
	HeadCountKV     int64  `json:"headCountKv"`
	ExpertCount     int64  `json:"expertCount"`
	ExpertUsedCount int64  `json:"expertUsedCount"`
	VocabSize       int64  `json:"vocabSize"`
	Vision          bool   `json:"vision"`
	Pooling         bool   `json:"pooling"`
}

type Detail struct {
	Model
	ID           string         `json:"id"`
	Host         string         `json:"host"`
	Path         string         `json:"path"`
	Capabilities []string       `json:"capabilities"`
	Layers       []Layer        `json:"layers"`
	UniqueBytes  int64          `json:"uniqueBytes"`
	Params       map[string]any `json:"params"`
	Template     string         `json:"template"`
	System       string         `json:"system"`
	License      string         `json:"license"`
	Arch         *Arch          `json:"arch"`
	ArchError    string         `json:"archError,omitempty"`
}

var archCache sync.Map

func readArch(path string) (*Arch, error) {
	if a, ok := archCache.Load(path); ok {
		return a.(*Arch), nil
	}
	md, err := gguf.ReadFile(path)
	if err != nil {
		return nil, err
	}
	arch := md.String("general.architecture")
	k := func(s string) int64 { return md.Int(arch + "." + s) }
	a := &Arch{
		Architecture:    arch,
		Name:            md.String("general.name"),
		Basename:        md.String("general.basename"),
		SizeLabel:       md.String("general.size_label"),
		License:         md.String("general.license"),
		ParameterCount:  md.Int("general.parameter_count"),
		ContextLength:   k("context_length"),
		EmbeddingLength: k("embedding_length"),
		BlockCount:      k("block_count"),
		HeadCount:       k("attention.head_count"),
		HeadCountKV:     k("attention.head_count_kv"),
		ExpertCount:     k("expert_count"),
		ExpertUsedCount: k("expert_used_count"),
		VocabSize:       md.Int("tokenizer.ggml.tokens"),
	}
	_, a.Vision = md[arch+".vision.block_count"]
	_, a.Pooling = md[arch+".pooling_type"]
	archCache.Store(path, a)
	return a, nil
}

func readSmall(path string, limit int64) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	b, _ := io.ReadAll(io.LimitReader(f, limit))
	return string(b)
}

// Details describes one installed model: its layers, architecture and capabilities.
func Details(modelsDir, hostModelsDir, host, model, tag string) (*Detail, error) {
	if !validModel.MatchString(model) || !validTag.MatchString(tag) {
		return nil, ErrInvalidName
	}
	p := ManifestPath(modelsDir, host, model, tag)
	man, raw, err := readManifest(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotInstalled
	}
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	rel, _ := filepath.Rel(modelsDir, p)
	d := &Detail{
		Model:  Model{Name: model + ":" + tag, Model: model, Tag: tag},
		ID:     hex.EncodeToString(sum[:])[:12],
		Host:   host,
		Path:   filepath.Join(hostModelsDir, rel),
		Layers: []Layer{},
	}
	if fi, err := os.Stat(p); err == nil {
		d.ModifiedAt = fi.ModTime()
	}
	cfg := readConfig(modelsDir, man)
	d.applyConfig(cfg)

	refs := BlobRefs(modelsDir)
	hasProjector := false
	for _, l := range uniqueBlobs(man) {
		d.Size += l.Size
		shared := refs[l.Digest] > 1
		if !shared {
			d.UniqueBytes += l.Size
		}
		if l.Digest == man.Config.Digest {
			continue
		}
		kind := l.MediaType[strings.LastIndex(l.MediaType, ".")+1:]
		d.Layers = append(d.Layers, Layer{Kind: kind, MediaType: l.MediaType, Digest: l.Digest, Size: l.Size, Shared: shared})
		bp := blobPath(modelsDir, l.Digest)
		switch kind {
		case "model":
			if d.Arch == nil {
				if a, err := readArch(bp); err == nil {
					d.Arch = a
				} else {
					d.ArchError = err.Error()
				}
			}
		case "projector":
			hasProjector = true
		case "template":
			d.Template = readSmall(bp, 64<<10)
		case "system":
			d.System = readSmall(bp, 64<<10)
		case "license":
			if d.License == "" {
				d.License = readSmall(bp, 64<<10)
			}
		case "params":
			_ = json.Unmarshal([]byte(readSmall(bp, 64<<10)), &d.Params)
		}
	}

	if d.Arch != nil && d.Arch.Pooling {
		d.Capabilities = append(d.Capabilities, "embedding")
	} else {
		d.Capabilities = append(d.Capabilities, "completion")
	}
	if strings.Contains(d.Template, ".Tools") || cfg.Parser != "" {
		d.Capabilities = append(d.Capabilities, "tools")
	}
	if strings.Contains(d.Template, ".Think") {
		d.Capabilities = append(d.Capabilities, "thinking")
	}
	if hasProjector || (d.Arch != nil && d.Arch.Vision) {
		d.Capabilities = append(d.Capabilities, "vision")
	}
	if strings.Contains(d.Template, ".Suffix") {
		d.Capabilities = append(d.Capabilities, "insert")
	}
	return d, nil
}
