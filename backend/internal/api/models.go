package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/ollama"
	"github.com/dagdan/ai-model-downloader/internal/store"
	"github.com/dagdan/ai-model-downloader/internal/sysinfo"
)

func (s *Server) installedDetail(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	d, err := installer.Details(s.cfg.ModelsDir, s.cfg.HostModelsDir, s.reg.Host(), q.Get("model"), q.Get("tag"))
	if err != nil {
		writeError(w, statusFor(err), err)
		return
	}
	writeJSON(w, 200, d)
}

// ollamaName is the name Ollama shows for a model from the default registry.
func ollamaName(model, tag string) string {
	return strings.TrimPrefix(model, "library/") + ":" + tag
}

func (s *Server) deleteInstalled(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	model, tag := r.URL.Query().Get("model"), r.URL.Query().Get("tag")

	keep := s.tr.ExternalDigests()
	list, err := s.store.List(ctx)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	for _, d := range list {
		if d.Status != store.StatusInstalled {
			for _, b := range d.Blobs {
				keep[b.Digest] = true
			}
		}
	}

	name := ollamaName(model, tag)
	for _, l := range s.ollama.Status(ctx).Loaded {
		if l.Name == name || l.Name == model+":"+tag {
			_ = s.ollama.Unload(ctx, l.Name)
		}
	}

	freed, err := installer.Remove(s.cfg.ModelsDir, s.reg.Host(), model, tag, func(d string) bool { return keep[d] })
	if err != nil {
		writeError(w, statusFor(err), err)
		return
	}
	if d, err := s.store.FindByModelTag(ctx, model, tag); err == nil && d.Status == store.StatusInstalled {
		_ = s.store.Delete(ctx, d.ID)
	}
	writeJSON(w, 200, map[string]int64{"freedBytes": freed})
}

type dashboardView struct {
	System    sysinfo.Info      `json:"system"`
	Ollama    ollama.Status     `json:"ollama"`
	ModelsDir string            `json:"modelsDir"`
	Storage   storageView       `json:"storage"`
	Models    []installer.Model `json:"models"`
}

type storageView struct {
	Models  int64 `json:"models"`
	Staging int64 `json:"staging"`
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	var v dashboardView
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); v.System = s.sys.Get(r.Context()) }()
	go func() { defer wg.Done(); v.Ollama = s.ollama.Status(r.Context()) }()
	v.ModelsDir = s.cfg.HostModelsDir
	v.Models = installer.InstalledModels(s.cfg.ModelsDir, s.reg.Host())
	v.Storage.Models = installer.UniqueBytes(s.cfg.ModelsDir)
	v.Storage.Staging = dirSize(r.Context(), s.cfg.StagingDir)
	wg.Wait()
	writeJSON(w, 200, v)
}

func dirSize(ctx context.Context, dir string) int64 {
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || ctx.Err() != nil {
			return ctx.Err()
		}
		if !d.IsDir() {
			if fi, err := d.Info(); err == nil {
				total += fi.Size()
			}
		}
		return nil
	})
	return total
}

type liveView struct {
	System  sysinfo.Live  `json:"system"`
	Ollama  ollama.Status `json:"ollama"`
	Staging int64         `json:"staging"`
}

// live streams fast-changing values (memory, disk, loaded models) as server-sent events.
func (s *Server) live(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, 500, fmt.Errorf("streaming is not supported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	ctx := r.Context()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	fmt.Fprint(w, "retry: 2000\n\n")
	for {
		var v liveView
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); v.System = s.sys.Live(ctx) }()
		go func() { defer wg.Done(); v.Ollama = s.ollama.Status(ctx) }()
		v.Staging = dirSize(ctx, s.cfg.StagingDir)
		wg.Wait()
		raw, _ := json.Marshal(v)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", raw); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
