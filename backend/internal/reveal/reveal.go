// Package reveal opens a path in the host's file manager (Finder, Explorer, or the Linux default).
package reveal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ErrFailed wraps errors from the reveal helper so the API can map them to 502.
var ErrFailed = errors.New("show in folder failed")

// Open shows path in the file manager. A file, or a directory when selectIt is
// true, is selected in its parent folder; otherwise a directory is opened.
func Open(path string, selectIt bool) error {
	fi, err := os.Stat(path)
	if err != nil {
		return err
	}
	sel := selectIt || !fi.IsDir()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		if sel {
			cmd = exec.Command("open", "-R", path)
		} else {
			cmd = exec.Command("open", path)
		}
	case "windows":
		if sel {
			cmd = exec.Command("explorer", "/select,"+path)
		} else {
			cmd = exec.Command("explorer", path)
		}
	default:
		if sel {
			path = filepath.Dir(path)
		}
		cmd = exec.Command("xdg-open", path)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("open file manager: %w", err)
	}
	go cmd.Wait()
	return nil
}

// Resolve joins rel onto root and rejects paths that escape root.
func Resolve(root, rel string) (string, error) {
	p := filepath.Join(root, filepath.FromSlash(rel))
	r, err := filepath.Rel(root, p)
	if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path outside models dir")
	}
	return p, nil
}

// Client opens paths inside the models dir, either directly or through the
// host reveal-helper when the backend runs in a container.
type Client struct {
	ModelsDir string
	HelperURL string
}

// Show reveals rel (relative to the models dir) in the file manager.
func (c Client) Show(ctx context.Context, rel string, selectIt bool) error {
	if c.HelperURL == "" {
		return Open(filepath.Join(c.ModelsDir, rel), selectIt)
	}
	body, _ := json.Marshal(map[string]any{"path": filepath.ToSlash(rel), "select": selectIt})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.HelperURL, "/")+"/reveal", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: reveal helper is not running on the host (re-run ./start.sh)", ErrFailed)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("%w: %s", ErrFailed, strings.TrimSpace(string(msg)))
	}
	return nil
}
