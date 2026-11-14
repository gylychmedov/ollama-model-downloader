package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Model struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Capabilities []string `json:"capabilities"`
	Sizes        []string `json:"sizes"`
	Pulls        string   `json:"pulls"`
}

type Info struct {
	Name         string   `json:"name"`
	Summary      string   `json:"summary"`
	Downloads    string   `json:"downloads"`
	Updated      string   `json:"updated"`
	UpdatedAt    string   `json:"updatedAt"`
	Capabilities []string `json:"capabilities"`
	Sizes        []string `json:"sizes"`
	Readme       string   `json:"readme"`
	URL          string   `json:"url"`
}

type Tag struct {
	Name    string `json:"name"`
	Param   string `json:"param"`
	Digest  string `json:"digest"`
	Size    string `json:"size"`
	Context string `json:"context"`
}

type Persist interface {
	CacheGet(ctx context.Context, key string) ([]byte, time.Time, bool)
	CacheSet(ctx context.Context, key string, data []byte)
}

type Client struct {
	base    string
	persist Persist
	http    *http.Client
	ttl     time.Duration

	mu         sync.Mutex
	cache      map[string]cacheEntry
	refreshing map[string]bool
}

type cacheEntry struct {
	at   time.Time
	data any
}

func New(base string, persist Persist) *Client {
	return &Client{
		base:       strings.TrimRight(base, "/"),
		persist:    persist,
		http:       &http.Client{Timeout: 2 * time.Minute},
		ttl:        10 * time.Minute,
		cache:      map[string]cacheEntry{},
		refreshing: map[string]bool{},
	}
}

var (
	reHref      = regexp.MustCompile(`<a href="/([\w.\-]+/[\w.\-]+)"`)
	reDesc      = regexp.MustCompile(`<p[^>]*>([^<]+)</p>`)
	reCap       = regexp.MustCompile(`bg-indigo-50[^>]*>([^<]+)</span>`)
	reSize      = regexp.MustCompile(`bg-\[#ddf4ff\][^>]*>([^<]+)</span>`)
	rePullsA    = regexp.MustCompile(`<span\s*>([^<]+)</span>\s*<span[^>]*>&nbsp;Pulls`)
	rePullsB    = regexp.MustCompile(`title="([\d,]+) downloads"`)
	reTag       = regexp.MustCompile(`<a href="/([^"]+):([^"]+)" class="md:hidden[\s\S]*?font-mono">\s*([0-9a-f]+)</span>\s*•\s*([^•<]+?)\s*•\s*([^•<]+?)\s*•`)
	reParam     = regexp.MustCompile(`(?i)^(\d+(\.\d+)?[bm]|e\d+(\.\d+)?b|\d+x\d+(\.\d+)?b)$`)
	reSummary   = regexp.MustCompile(`id="summary-content">\s*([^<]*)<`)
	reDownloads = regexp.MustCompile(`<span\s*>([^<]+)</span>\s*<span[^>]*>&nbsp;Downloads`)
	reUpdated   = regexp.MustCompile(`title="([^"]+)">[\s\S]{0,600}?Updated&nbsp;</span>\s*<span\s*>([^<]+)</span>`)
	reRelURL    = regexp.MustCompile(`\b(src|href)="/`)
	validName   = regexp.MustCompile(`^[\w.\-]+/[\w.\-]+$`)
)

func (c *Client) Search(ctx context.Context, query, sort string) ([]Model, error) {
	if sort != "newest" {
		sort = "popular"
	}
	path := "/library?sort=" + sort
	if query != "" {
		path = "/search?o=" + sort + "&q=" + url.QueryEscape(query)
	}
	return load(ctx, c, "search:"+sort+":"+query, func(ctx context.Context) ([]Model, error) {
		body, err := c.get(ctx, path)
		if err != nil {
			return nil, err
		}
		models := parseModels(body)
		if len(models) == 0 && query == "" {
			return nil, errors.New("ollama.com returned no models")
		}
		return models, nil
	})
}

func (c *Client) Prewarm(ctx context.Context) {
	for _, sort := range []string{"popular", "newest"} {
		if _, err := c.Search(ctx, "", sort); err != nil {
			log.Printf("prewarm library (%s): %v", sort, err)
		}
	}
}

func (c *Client) Tags(ctx context.Context, name string) ([]Tag, error) {
	if !validName.MatchString(name) {
		return nil, fmt.Errorf("invalid model name %q", name)
	}
	return load(ctx, c, "tags:"+name, func(ctx context.Context) ([]Tag, error) {
		body, err := c.get(ctx, "/"+name+"/tags")
		if err != nil {
			return nil, err
		}
		return parseTags(body, name), nil
	})
}

func (c *Client) Info(ctx context.Context, name string) (*Info, error) {
	if !validName.MatchString(name) {
		return nil, fmt.Errorf("invalid model name %q", name)
	}
	return load(ctx, c, "info:"+name, func(ctx context.Context) (*Info, error) {
		body, err := c.get(ctx, "/"+name)
		if err != nil {
			return nil, err
		}
		return c.parseInfo(body, name), nil
	})
}

func (c *Client) parseInfo(body, name string) *Info {
	info := &Info{Name: name, Capabilities: []string{}, Sizes: []string{}, URL: c.base + "/" + name}
	head, readme := body, ""
	if i := strings.Index(body, `id="readme"`); i >= 0 {
		head, readme = body[:i], body[i:]
	}
	if m := reSummary.FindStringSubmatch(head); m != nil {
		info.Summary = strings.TrimSpace(html.UnescapeString(m[1]))
	}
	if m := reDownloads.FindStringSubmatch(head); m != nil {
		info.Downloads = strings.TrimSpace(m[1])
	}
	if m := reUpdated.FindStringSubmatch(head); m != nil {
		info.UpdatedAt, info.Updated = m[1], strings.TrimSpace(m[2])
	}
	for _, m := range reCap.FindAllStringSubmatch(head, -1) {
		info.Capabilities = appendUnique(info.Capabilities, strings.TrimSpace(m[1]))
	}
	for _, m := range reSize.FindAllStringSubmatch(head, -1) {
		info.Sizes = appendUnique(info.Sizes, strings.TrimSpace(m[1]))
	}
	if i := strings.Index(readme, `id="display"`); i >= 0 {
		readme = readme[i:]
		if j := strings.Index(readme, ">"); j >= 0 {
			readme = readme[j+1:]
		}
		if j := strings.Index(readme, `id="editorContainer"`); j >= 0 {
			readme = readme[:j]
			if k := strings.LastIndex(readme, "<div"); k >= 0 {
				readme = readme[:k]
			}
			for range 2 {
				readme = strings.TrimSuffix(strings.TrimSpace(readme), "</div>")
			}
		}
		readme = reRelURL.ReplaceAllString(readme, `$1="`+c.base+`/`)
		info.Readme = strings.TrimSpace(readme)
	}
	return info
}

func appendUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

func parseModels(body string) []Model {
	var out []Model
	seen := map[string]bool{}
	for _, chunk := range strings.Split(body, "<li")[1:] {
		if !strings.Contains(chunk, "<h2") {
			continue
		}
		m := reHref.FindStringSubmatch(chunk)
		if m == nil || seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		model := Model{Name: m[1], Capabilities: []string{}, Sizes: []string{}}
		if d := reDesc.FindStringSubmatch(chunk); d != nil {
			model.Description = strings.TrimSpace(html.UnescapeString(d[1]))
		}
		for _, c := range reCap.FindAllStringSubmatch(chunk, -1) {
			model.Capabilities = append(model.Capabilities, strings.TrimSpace(c[1]))
		}
		for _, s := range reSize.FindAllStringSubmatch(chunk, -1) {
			model.Sizes = append(model.Sizes, strings.TrimSpace(s[1]))
		}
		if p := rePullsA.FindStringSubmatch(chunk); p != nil {
			model.Pulls = strings.TrimSpace(p[1])
		} else if p := rePullsB.FindStringSubmatch(chunk); p != nil {
			model.Pulls = p[1]
		}
		out = append(out, model)
	}
	return out
}

func parseTags(body, name string) []Tag {
	var out []Tag
	seen := map[string]bool{}
	for _, m := range reTag.FindAllStringSubmatch(body, -1) {
		if m[1] != name || seen[m[2]] {
			continue
		}
		seen[m[2]] = true
		out = append(out, Tag{
			Name:    m[2],
			Param:   ParamOf(m[2]),
			Digest:  m[3],
			Size:    strings.TrimSpace(m[4]),
			Context: strings.TrimSuffix(strings.TrimSpace(m[5]), " context window"),
		})
	}
	return out
}

func ParamOf(tag string) string {
	first := strings.SplitN(tag, "-", 2)[0]
	if reParam.MatchString(first) {
		return strings.ToLower(first)
	}
	if tag == "latest" {
		return "latest"
	}
	return "other"
}

func (c *Client) get(ctx context.Context, path string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama.com %s: %s", path, resp.Status)
	}
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}

func load[T any](ctx context.Context, c *Client, key string, fetch func(context.Context) (T, error)) (T, error) {
	c.mu.Lock()
	e, ok := c.cache[key]
	if !ok && c.persist != nil {
		c.mu.Unlock()
		var v T
		if raw, at, found := c.persist.CacheGet(ctx, key); found && json.Unmarshal(raw, &v) == nil {
			e, ok = cacheEntry{at: at, data: v}, true
		}
		c.mu.Lock()
		if ok {
			c.cache[key] = e
		}
	}
	if ok {
		if time.Since(e.at) > c.ttl && !c.refreshing[key] {
			c.refreshing[key] = true
			go func() {
				_, _ = refresh(context.Background(), c, key, fetch)
				c.mu.Lock()
				delete(c.refreshing, key)
				c.mu.Unlock()
			}()
		}
		c.mu.Unlock()
		return e.data.(T), nil
	}
	c.mu.Unlock()
	return refresh(context.WithoutCancel(ctx), c, key, fetch)
}

func refresh[T any](ctx context.Context, c *Client, key string, fetch func(context.Context) (T, error)) (T, error) {
	v, err := fetch(ctx)
	if err != nil {
		return v, err
	}
	c.mu.Lock()
	c.cache[key] = cacheEntry{at: time.Now(), data: v}
	c.mu.Unlock()
	if c.persist != nil {
		if raw, err := json.Marshal(v); err == nil {
			c.persist.CacheSet(ctx, key, raw)
		}
	}
	return v, nil
}
