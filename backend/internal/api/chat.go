package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/ollama"
)

type chatEvent struct {
	Type  string        `json:"type"`
	Text  string        `json:"text,omitempty"`
	Stats *ollama.Stats `json:"stats,omitempty"`
	Error string        `json:"error,omitempty"`
}

// chat runs one prompt against an installed model and streams NDJSON events: thinking, token, done or error.
func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Model  string `json:"model"`
		Tag    string `json:"tag"`
		Prompt string `json:"prompt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if strings.TrimSpace(body.Prompt) == "" {
		writeError(w, 400, errors.New("prompt is empty"))
		return
	}
	if !slices.Contains(installer.Installed(s.cfg.ModelsDir, s.reg.Host()), body.Model+":"+body.Tag) {
		writeError(w, 404, installer.ErrNotInstalled)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	rc := http.NewResponseController(w)
	enc := json.NewEncoder(w)
	send := func(e chatEvent) error {
		if err := enc.Encode(e); err != nil {
			return err
		}
		return rc.Flush()
	}

	stats, err := s.ollama.Generate(r.Context(), ollamaName(body.Model, body.Tag), body.Prompt, func(c ollama.Chunk) error {
		if c.Thinking != "" {
			if err := send(chatEvent{Type: "thinking", Text: c.Thinking}); err != nil {
				return err
			}
		}
		if c.Response != "" {
			return send(chatEvent{Type: "token", Text: c.Response})
		}
		return nil
	})
	if err != nil {
		if r.Context().Err() == nil {
			_ = send(chatEvent{Type: "error", Error: err.Error()})
		}
		return
	}
	_ = send(chatEvent{Type: "done", Stats: &stats})
}
