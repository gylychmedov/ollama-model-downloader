// Package sysinfo reports CPU, memory and disk space of the machine it runs on.
package sysinfo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

type Info struct {
	Hostname        string `json:"hostname"`
	OS              string `json:"os"`
	OSVersion       string `json:"osVersion"`
	Arch            string `json:"arch"`
	CPU             string `json:"cpu"`
	Cores           int    `json:"cores"`
	MemoryTotal     uint64 `json:"memoryTotal"`
	MemoryAvailable uint64 `json:"memoryAvailable"`
	DiskTotal       uint64 `json:"diskTotal"`
	DiskFree        uint64 `json:"diskFree"`
	// Source is "host" when read on the host machine, "container" when the values describe the Docker VM.
	Source string `json:"source"`
}

// Collect reads system information; disk space is measured for the filesystem holding dir.
func Collect(dir string) Info {
	info := Info{OS: runtime.GOOS, Arch: runtime.GOARCH, Cores: runtime.NumCPU(), Source: "host"}
	info.Hostname, _ = os.Hostname()
	collectPlatform(&info)
	info.MemoryTotal, info.MemoryAvailable = memory()
	info.DiskTotal, info.DiskFree = diskSpace(dir)
	return info
}

// Live holds the values that change from second to second.
type Live struct {
	MemoryTotal     uint64 `json:"memoryTotal"`
	MemoryAvailable uint64 `json:"memoryAvailable"`
	DiskTotal       uint64 `json:"diskTotal"`
	DiskFree        uint64 `json:"diskFree"`
	Source          string `json:"source"`
}

func CollectLive(dir string) Live {
	l := Live{Source: "host"}
	l.MemoryTotal, l.MemoryAvailable = memory()
	l.DiskTotal, l.DiskFree = diskSpace(dir)
	return l
}

// Client fetches host info from the reveal-helper and falls back to this process.
type Client struct {
	Dir       string
	HelperURL string
}

func (c Client) Get(ctx context.Context) Info {
	if c.HelperURL != "" {
		var info Info
		if c.fromHelper(ctx, "/system", &info) == nil {
			return info
		}
		info = Collect(c.Dir)
		info.Source = "container"
		return info
	}
	return Collect(c.Dir)
}

func (c Client) Live(ctx context.Context) Live {
	if c.HelperURL != "" {
		var l Live
		if c.fromHelper(ctx, "/live", &l) == nil {
			return l
		}
		l = CollectLive(c.Dir)
		l.Source = "container"
		return l
	}
	return CollectLive(c.Dir)
}

func (c Client) fromHelper(ctx context.Context, path string, v any) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.HelperURL, "/")+path, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("helper: %s", res.Status)
	}
	return json.NewDecoder(res.Body).Decode(v)
}
