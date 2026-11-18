// Package ollama talks to a running Ollama server for runtime status.
package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Loaded struct {
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	SizeVRAM  int64     `json:"size_vram"`
	ExpiresAt time.Time `json:"expires_at"`
	Context   int64     `json:"context_length"`
}

type Status struct {
	URL     string   `json:"url"`
	Running bool     `json:"running"`
	Version string   `json:"version"`
	Loaded  []Loaded `json:"loaded"`
}

type Client struct {
	base string
	http *http.Client
}

func New(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: 3 * time.Second}}
}

func (c *Client) Status(ctx context.Context) Status {
	s := Status{URL: c.base, Loaded: []Loaded{}}
	var v struct {
		Version string `json:"version"`
	}
	if c.get(ctx, "/api/version", &v) != nil {
		return s
	}
	s.Running, s.Version = true, v.Version
	var ps struct {
		Models []Loaded `json:"models"`
	}
	if c.get(ctx, "/api/ps", &ps) == nil && ps.Models != nil {
		s.Loaded = ps.Models
	}
	return s
}

// Unload asks Ollama to free a model from memory; errors are ignored by callers.
func (c *Client) Unload(ctx context.Context, name string) error {
	body, _ := json.Marshal(map[string]any{"model": name, "keep_alive": 0})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	return nil
}

func (c *Client) get(ctx context.Context, path string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("ollama %s: %s", path, res.Status)
	}
	return json.NewDecoder(res.Body).Decode(v)
}
