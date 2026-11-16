package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/dagdan/ai-model-downloader/internal/config"
	"github.com/dagdan/ai-model-downloader/internal/downloader"
	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/library"
	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/reveal"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

type Server struct {
	cfg     config.Config
	store   *store.Store
	lib     *library.Client
	reg     *registry.Client
	manager *downloader.Manager
}

type downloadView struct {
	store.Download
	Stats *downloader.Stats `json:"live"`
}

func New(cfg config.Config, s *store.Store, lib *library.Client, reg *registry.Client, m *downloader.Manager) http.Handler {
	srv := &Server{cfg: cfg, store: s, lib: lib, reg: reg, manager: m}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/library", srv.library)
	mux.HandleFunc("GET /api/models/{ns}/{name}", srv.info)
	mux.HandleFunc("GET /api/models/{ns}/{name}/tags", srv.tags)
	mux.HandleFunc("GET /api/installed", srv.installed)
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
	if s.cfg.RevealURL == "" {
		return reveal.Open(filepath.Join(s.cfg.ModelsDir, rel))
	}
	body, _ := json.Marshal(map[string]string{"path": filepath.ToSlash(rel)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.cfg.RevealURL, "/")+"/reveal", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: reveal helper is not running on the host (re-run ./start.sh)", errHelper)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("%w: %s", errHelper, strings.TrimSpace(string(msg)))
	}
	return nil
}

var errHelper = errors.New("show in folder failed")

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
	case errors.Is(err, store.ErrNotFound):
		return 404
	case errors.Is(err, downloader.ErrBadState):
		return 409
	case errors.Is(err, errHelper):
		return http.StatusBadGateway
	}
	return 500
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
