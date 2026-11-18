package api

import (
	"encoding/json"
	"net/http"

	"github.com/dagdan/ai-model-downloader/internal/notify"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	v, err := s.store.Settings(r.Context())
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var v store.Settings
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		writeError(w, 400, err)
		return
	}
	if err := s.store.SaveSettings(r.Context(), v); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) testNotification(w http.ResponseWriter, r *http.Request) {
	nc := notify.Client{HelperURL: s.cfg.RevealURL}
	if err := nc.Send(r.Context(), "Model Downloader", "Notifications are working"); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
