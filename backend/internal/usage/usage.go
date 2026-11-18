// Package usage records when installed models were last loaded in Ollama.
package usage

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/ollama"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

const interval = 30 * time.Second

// Canonical turns a name as Ollama shows it into namespace/model:tag, or "" for other registries.
func Canonical(name string) string {
	model, tag, ok := strings.Cut(name, ":")
	if !ok || tag == "" {
		tag = "latest"
	}
	switch strings.Count(model, "/") {
	case 0:
		model = "library/" + model
	case 1:
	default:
		return ""
	}
	return model + ":" + tag
}

// Track polls Ollama for loaded models and stores their last-used time until ctx ends.
func Track(ctx context.Context, oc *ollama.Client, st *store.Store) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		var names []string
		for _, l := range oc.Status(ctx).Loaded {
			if n := Canonical(l.Name); n != "" {
				names = append(names, n)
			}
		}
		if err := st.TouchUsage(ctx, names); err != nil && ctx.Err() == nil {
			log.Printf("record model usage: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
