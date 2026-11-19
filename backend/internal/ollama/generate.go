package ollama

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

type Chunk struct {
	Response string `json:"response,omitempty"`
	Thinking string `json:"thinking,omitempty"`
}

// Stats are Ollama's timings for one generation plus the time to the first token measured here.
type Stats struct {
	FirstTokenMs float64 `json:"firstTokenMs"`
	TotalMs      float64 `json:"totalMs"`
	LoadMs       float64 `json:"loadMs"`
	PromptTokens int     `json:"promptTokens"`
	PromptMs     float64 `json:"promptMs"`
	OutputTokens int     `json:"outputTokens"`
	OutputMs     float64 `json:"outputMs"`
	TokensPerSec float64 `json:"tokensPerSec"`
	PromptPerSec float64 `json:"promptPerSec"`
	DoneReason   string  `json:"doneReason"`
}

type generateLine struct {
	Chunk
	Error              string `json:"error"`
	Done               bool   `json:"done"`
	DoneReason         string `json:"done_reason"`
	TotalDuration      int64  `json:"total_duration"`
	LoadDuration       int64  `json:"load_duration"`
	PromptEvalCount    int    `json:"prompt_eval_count"`
	PromptEvalDuration int64  `json:"prompt_eval_duration"`
	EvalCount          int    `json:"eval_count"`
	EvalDuration       int64  `json:"eval_duration"`
}

var streamClient = &http.Client{}

// Generate streams a single-prompt completion, calling onChunk for each piece of output.
func (c *Client) Generate(ctx context.Context, model, prompt string, onChunk func(Chunk) error) (Stats, error) {
	body, _ := json.Marshal(map[string]any{"model": model, "prompt": prompt, "stream": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return Stats{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	start := time.Now()
	res, err := streamClient.Do(req)
	if err != nil {
		return Stats{}, fmt.Errorf("ollama is not reachable: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&e)
		if e.Error == "" {
			e.Error = res.Status
		}
		return Stats{}, errors.New(e.Error)
	}

	var st Stats
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var l generateLine
		if err := json.Unmarshal(sc.Bytes(), &l); err != nil {
			return st, fmt.Errorf("bad response from ollama: %w", err)
		}
		if l.Error != "" {
			return st, errors.New(l.Error)
		}
		if st.FirstTokenMs == 0 && (l.Response != "" || l.Thinking != "") {
			st.FirstTokenMs = ms(time.Since(start))
		}
		if l.Response != "" || l.Thinking != "" {
			if err := onChunk(l.Chunk); err != nil {
				return st, err
			}
		}
		if l.Done {
			st.TotalMs = ms(time.Since(start))
			st.LoadMs = ms(time.Duration(l.LoadDuration))
			st.PromptTokens, st.PromptMs = l.PromptEvalCount, ms(time.Duration(l.PromptEvalDuration))
			st.OutputTokens, st.OutputMs = l.EvalCount, ms(time.Duration(l.EvalDuration))
			st.TokensPerSec = rate(l.EvalCount, l.EvalDuration)
			st.PromptPerSec = rate(l.PromptEvalCount, l.PromptEvalDuration)
			st.DoneReason = l.DoneReason
			return st, nil
		}
	}
	if err := sc.Err(); err != nil {
		return st, err
	}
	return st, errors.New("ollama closed the stream early")
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

func rate(n int, ns int64) float64 {
	if ns <= 0 {
		return 0
	}
	return float64(n) / (float64(ns) / 1e9)
}
