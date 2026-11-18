// Package notify shows desktop notifications on the host, directly or through the host helper.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const maxLen = 200

// Show displays a notification on this machine.
func Show(title, body string) error {
	title, body = clip(title), clip(body)
	var name string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		name, args = "osascript", []string{
			"-e", "on run argv",
			"-e", "display notification (item 2 of argv) with title (item 1 of argv)",
			"-e", "end run", title, body}
	case "linux":
		name, args = "notify-send", []string{"--", title, body}
	default:
		return errors.New("desktop notifications are not supported on " + runtime.GOOS)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, name, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func clip(s string) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > maxLen {
		return string(r[:maxLen-1]) + "…"
	}
	return s
}

// Client sends notifications directly, or through the host helper when the backend runs in a container.
type Client struct {
	HelperURL string
}

func (c Client) Send(ctx context.Context, title, body string) error {
	if c.HelperURL == "" {
		return Show(title, body)
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.HelperURL, "/")+"/notify", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("host helper is not running (re-run ./start.sh): %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("notification failed: %s", strings.TrimSpace(string(msg)))
	}
	return nil
}
