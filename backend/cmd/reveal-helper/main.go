// reveal-helper runs on the host (outside Docker) so the backend can open
// downloaded files in Finder / Explorer. It only accepts paths inside the
// Ollama models dir and only listens on loopback.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dagdan/ai-model-downloader/internal/reveal"
)

func main() {
	root := os.Getenv("OLLAMA_MODELS_DIR")
	if root == "" {
		home, _ := os.UserHomeDir()
		root = filepath.Join(home, ".ollama", "models")
	}
	addr := "127.0.0.1:" + envOr("REVEAL_PORT", "8471")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("POST /reveal", func(w http.ResponseWriter, r *http.Request) {
		// Requiring JSON forces a CORS preflight, so web pages can't trigger this.
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			http.Error(w, "expected application/json", http.StatusUnsupportedMediaType)
			return
		}
		var body struct {
			Path   string `json:"path"`
			Select bool   `json:"select"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		p, err := reveal.Resolve(root, body.Path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		if err := reveal.Open(p, body.Select); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	log.Printf("reveal-helper listening on %s (models dir %s)", addr, root)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
