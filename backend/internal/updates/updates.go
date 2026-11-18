package updates

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/registry"
)

const (
	cacheTTL    = 30 * time.Minute
	concurrency = 4
)

type Status struct {
	Name          string    `json:"name"`
	Model         string    `json:"model"`
	Tag           string    `json:"tag"`
	Available     bool      `json:"available"`
	DownloadBytes int64     `json:"downloadBytes"`
	CheckedAt     time.Time `json:"checkedAt"`
	Error         string    `json:"error,omitempty"`
}

type remote struct {
	man registry.Manifest
	err error
	at  time.Time
}

// Checker compares installed manifests with the registry, caching registry answers.
type Checker struct {
	reg       *registry.Client
	modelsDir string

	mu    sync.Mutex
	cache map[string]remote
}

func New(reg *registry.Client, modelsDir string) *Checker {
	return &Checker{reg: reg, modelsDir: modelsDir, cache: map[string]remote{}}
}

func (c *Checker) Check(ctx context.Context, refresh bool) []Status {
	names := installer.Installed(c.modelsDir, c.reg.Host())
	out := make([]Status, len(names))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i, name := range names {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			out[i] = c.check(ctx, name, refresh)
		}()
	}
	wg.Wait()
	return out
}

func (c *Checker) check(ctx context.Context, name string, refresh bool) Status {
	model, tag, _ := strings.Cut(name, ":")
	s := Status{Name: name, Model: model, Tag: tag}
	local, err := installer.LocalManifest(c.modelsDir, c.reg.Host(), model, tag)
	if err != nil {
		s.Error = err.Error()
		return s
	}
	r := c.fetch(ctx, model, tag, refresh)
	s.CheckedAt = r.at
	if r.err != nil {
		s.Error = r.err.Error()
		return s
	}
	if !installer.SameBlobs(local, r.man) {
		s.Available = true
		s.DownloadBytes = installer.MissingBytes(c.modelsDir, r.man)
	}
	return s
}

func (c *Checker) fetch(ctx context.Context, model, tag string, refresh bool) remote {
	key := model + ":" + tag
	c.mu.Lock()
	r, ok := c.cache[key]
	c.mu.Unlock()
	if ok && !refresh && time.Since(r.at) < cacheTTL {
		return r
	}
	_, man, err := c.reg.Manifest(ctx, model, tag)
	r = remote{man: man, err: err, at: time.Now()}
	if ctx.Err() == nil {
		c.mu.Lock()
		c.cache[key] = r
		c.mu.Unlock()
	}
	return r
}
