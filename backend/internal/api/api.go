package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/dagdan/ai-model-downloader/internal/config"
	"github.com/dagdan/ai-model-downloader/internal/downloader"
	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/library"
	"github.com/dagdan/ai-model-downloader/internal/ollama"
	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/reveal"
	"github.com/dagdan/ai-model-downloader/internal/store"
	"github.com/dagdan/ai-model-downloader/internal/sysinfo"
	"github.com/dagdan/ai-model-downloader/internal/transfer"
)

type Server struct {
	cfg     config.Config
	store   *store.Store
	lib     *library.Client
	reg     *registry.Client
	manager *downloader.Manager
	tr      *transfer.Manager
	rv      reveal.Client
	ollama  *ollama.Client
	sys     sysinfo.Client
}

type downloadView struct {
	store.Download
	Stats *downloader.Stats `json:"live"`
}

func New(cfg config.Config, s *store.Store, lib *library.Client, reg *registry.Client, m *downloader.Manager, tr *transfer.Manager, rv reveal.Client) http.Handler {
	srv := &Server{cfg: cfg, store: s, lib: lib, reg: reg, manager: m, tr: tr, rv: rv,
		ollama: ollama.New(cfg.OllamaURL), sys: sysinfo.Client{Dir: cfg.ModelsDir, HelperURL: cfg.RevealURL}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/library", srv.library)
	mux.HandleFunc("GET /api/models/{ns}/{name}", srv.info)
	mux.HandleFunc("GET /api/models/{ns}/{name}/tags", srv.tags)
	mux.HandleFunc("GET /api/installed", srv.installed)
	mux.HandleFunc("GET /api/installed/models", srv.installedModels)
	mux.HandleFunc("GET /api/installed/detail", srv.installedDetail)
	mux.HandleFunc("DELETE /api/installed", srv.deleteInstalled)
	mux.HandleFunc("GET /api/dashboard", srv.dashboard)
	mux.HandleFunc("GET /api/live", srv.live)
	mux.HandleFunc("POST /api/installed/export", srv.export)
	mux.HandleFunc("GET /api/transfers", srv.listTransfers)
	mux.HandleFunc("POST /api/transfers/open", srv.openTransferDir)
	mux.HandleFunc("PUT /api/transfers/upload", srv.upload)
	mux.HandleFunc("POST /api/transfers/{name}/install", srv.transferAction(func(_ context.Context, n string) error { return tr.Install(n) }))
	mux.HandleFunc("POST /api/transfers/{name}/reveal", srv.transferAction(tr.Reveal))
	mux.HandleFunc("DELETE /api/transfers/{name}", srv.transferAction(func(_ context.Context, n string) error { return tr.Delete(n) }))
	mux.HandleFunc("GET /api/downloads", srv.listDownloads)
	mux.HandleFunc("POST /api/downloads", srv.createDownload)
	mux.HandleFunc("POST /api/downloads/{id}/pause", srv.action(m.Pause))
	mux.HandleFunc("POST /api/downloads/{id}/resume", srv.action(m.Resume))
	mux.HandleFunc("POST /api/downloads/{id}/install", srv.action(m.Install))
	mux.HandleFunc("POST /api/downloads/{id}/reveal", srv.action(srv.reveal))
	mux.HandleFunc("DELETE /api/downloads/{id}", srv.action(m.Delete))
	return withCORS(mux)
}

func (s *Server) library(w http.ResponseWriter, r *http.Request) {
	models, err := s.lib.Search(r.Context(), strings.TrimSpace(r.URL.Query().Get("q")), r.URL.Query().Get("sort"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, 200, models)
}

func (s *Server) info(w http.ResponseWriter, r *http.Request) {
	info, err := s.lib.Info(r.Context(), r.PathValue("ns")+"/"+r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, 200, info)
}

func (s *Server) tags(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("ns") + "/" + r.PathValue("name")
	tags, err := s.lib.Tags(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, 200, map[string]any{"name": name, "tags": tags})
}

func (s *Server) installed(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, installer.Installed(s.cfg.ModelsDir, s.reg.Host()))
}

func (s *Server) listDownloads(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.List(r.Context())
	if err != nil {
		writeError(w, 500, err)
		return
	}
	out := make([]downloadView, 0, len(list))
	for _, d := range list {
		v := downloadView{Download: d, Stats: s.manager.Stats(d.ID)}
		if v.Stats != nil {
			v.Downloaded = max(v.Downloaded, v.Stats.Downloaded)
		}
		out = append(out, v)
	}
	writeJSON(w, 200, out)
}

func (s *Server) createDownload(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Model string `json:"model"`
		Tag   string `json:"tag"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if !strings.Contains(body.Model, "/") {
		body.Model = "library/" + body.Model
	}
	if body.Tag == "" {
		body.Tag = "latest"
	}
	d, err := s.manager.Create(r.Context(), body.Model, body.Tag)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, 201, d)
}

func (s *Server) action(fn func(context.Context, int64) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := parseID(r)
		if err != nil {
			writeError(w, 400, err)
			return
		}
		if err := fn(r.Context(), id); err != nil {
			writeError(w, statusFor(err), err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) reveal(ctx context.Context, id int64) error {
	rel, err := s.manager.FilesPath(ctx, id)
	if err != nil {
		return err
	}
	return s.rv.Show(ctx, rel, false)
}

func (s *Server) installedModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, installer.InstalledModels(s.cfg.ModelsDir, s.reg.Host()))
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Model string `json:"model"`
		Tag   string `json:"tag"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	name, err := s.tr.Export(body.Model, body.Tag)
	if err != nil {
		writeError(w, statusFor(err), err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"name": name})
}

func (s *Server) listTransfers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"dir": s.tr.Dir(), "packages": s.tr.List()})
}

func (s *Server) openTransferDir(w http.ResponseWriter, r *http.Request) {
	if err := s.tr.OpenDir(r.Context()); err != nil {
		writeError(w, statusFor(err), err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// upload receives one file of a package: PUT /api/transfers/upload?package=<name>&path=<path inside package>
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if err := s.tr.Upload(q.Get("package"), q.Get("path"), r.ContentLength, r.Body); err != nil {
		writeError(w, statusFor(err), err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) transferAction(fn func(context.Context, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(r.Context(), r.PathValue("name")); err != nil {
			writeError(w, statusFor(err), err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func parseID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, store.ErrNotFound), errors.Is(err, transfer.ErrNotFound), errors.Is(err, installer.ErrNotInstalled):
		return 404
	case errors.Is(err, downloader.ErrBadState), errors.Is(err, transfer.ErrBadState), errors.Is(err, transfer.ErrBusy):
		return 409
	case errors.Is(err, transfer.ErrInvalid), errors.Is(err, installer.ErrInvalidName):
		return 400
	case errors.Is(err, reveal.ErrFailed):
		return http.StatusBadGateway
	}
	return 500
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
