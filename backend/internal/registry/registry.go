package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const manifestMediaType = "application/vnd.docker.distribution.manifest.v2+json"

type Layer struct {
	MediaType string `json:"mediaType"`
	Digest    string `json:"digest"`
	Size      int64  `json:"size"`
}

type Manifest struct {
	SchemaVersion int     `json:"schemaVersion"`
	MediaType     string  `json:"mediaType"`
	Config        Layer   `json:"config"`
	Layers        []Layer `json:"layers"`
}

func (m Manifest) AllBlobs() []Layer {
	return append([]Layer{m.Config}, m.Layers...)
}

type Client struct {
	base string
	http *http.Client
}

func New(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) Host() string {
	return strings.TrimPrefix(strings.TrimPrefix(c.base, "https://"), "http://")
}

func (c *Client) Manifest(ctx context.Context, model, tag string) (string, Manifest, error) {
	var m Manifest
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/v2/%s/manifests/%s", c.base, model, tag), nil)
	if err != nil {
		return "", m, err
	}
	req.Header.Set("Accept", manifestMediaType)
	resp, err := c.http.Do(req)
	if err != nil {
		return "", m, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", m, fmt.Errorf("manifest %s:%s: %s", model, tag, resp.Status)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", m, err
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", m, fmt.Errorf("parse manifest: %w", err)
	}
	return string(raw), m, nil
}

func (c *Client) BlobURL(model, digest string) string {
	return fmt.Sprintf("%s/v2/%s/blobs/%s", c.base, model, digest)
}
