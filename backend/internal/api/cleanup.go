package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/cleanup"
	"github.com/dagdan/ai-model-downloader/internal/usage"
)

const defaultUnusedDays = 30

// cleanupMu stops two cleanups from deleting the same files at once.
var cleanupMu sync.Mutex

type cleanupView struct {
	Items         []cleanup.Item `json:"items"`
	UnusedDays    int            `json:"unusedDays"`
	StaleDays     int            `json:"staleDays"`
	TrackingSince time.Time      `json:"trackingSince"`
	ScannedAt     time.Time      `json:"scannedAt"`
}

func (s *Server) cleanupInput(ctx context.Context, days int) (cleanup.Input, time.Time, error) {
	in := cleanup.Input{
		ModelsDir:   s.cfg.ModelsDir,
		StagingDir:  s.cfg.StagingDir,
		Host:        s.reg.Host(),
		Active:      func(id int64) bool { return s.manager.Stats(id) != nil },
		Loaded:      map[string]bool{},
		UnusedAfter: time.Duration(days) * 24 * time.Hour,
		Now:         time.Now(),
	}
	var err error
	if in.Downloads, err = s.store.List(ctx); err != nil {
		return in, time.Time{}, err
	}
	if in.Keep, err = s.manager.KeepDigests(ctx); err != nil {
		return in, time.Time{}, err
	}
	lastUsed, since, err := s.store.Usage(ctx)
	if err != nil {
		return in, time.Time{}, err
	}
	in.LastUsed = lastUsed
	for _, l := range s.ollama.Status(ctx).Loaded {
		in.Loaded[usage.Canonical(l.Name)] = true
	}
	return in, since, nil
}

func unusedDays(v string) int {
	if n, err := strconv.Atoi(v); err == nil && n >= 1 {
		return n
	}
	return defaultUnusedDays
}

func (s *Server) cleanupScan(w http.ResponseWriter, r *http.Request) {
	days := unusedDays(r.URL.Query().Get("days"))
	in, since, err := s.cleanupInput(r.Context(), days)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	items := cleanup.Scan(in)
	if items == nil {
		items = []cleanup.Item{}
	}
	writeJSON(w, 200, cleanupView{Items: items, UnusedDays: days, StaleDays: int(cleanup.StaleDownload.Hours() / 24), TrackingSince: since, ScannedAt: in.Now})
}

func (s *Server) cleanupRun(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs  []string `json:"ids"`
		Days int      `json:"days"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	cleanupMu.Lock()
	defer cleanupMu.Unlock()
	ctx := r.Context()
	in, _, err := s.cleanupInput(ctx, unusedDays(strconv.Itoa(body.Days)))
	if err != nil {
		writeError(w, 500, err)
		return
	}
	res := cleanup.Clean(in, body.IDs, cleanup.Actions{
		RemoveModel:    func(model, tag string) (int64, error) { return s.removeModel(ctx, model, tag, in.Keep) },
		DeleteDownload: func(id int64) error { return s.manager.Delete(ctx, id) },
	})
	writeJSON(w, 200, res)
}
