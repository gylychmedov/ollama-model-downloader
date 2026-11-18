package sysinfo

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

func collectPlatform(info *Info) {
	info.OS = "Linux"
	if f, err := os.Open("/etc/os-release"); err == nil {
		s := bufio.NewScanner(f)
		for s.Scan() {
			if v, ok := strings.CutPrefix(s.Text(), "PRETTY_NAME="); ok {
				info.OSVersion = strings.Trim(v, `"`)
			}
		}
		f.Close()
	}
	if f, err := os.Open("/proc/cpuinfo"); err == nil {
		s := bufio.NewScanner(f)
		for s.Scan() {
			if k, v, ok := strings.Cut(s.Text(), ":"); ok && strings.TrimSpace(k) == "model name" {
				info.CPU = strings.TrimSpace(v)
				break
			}
		}
		f.Close()
	}
}

func memory() (total, available uint64) {
	if f, err := os.Open("/proc/meminfo"); err == nil {
		s := bufio.NewScanner(f)
		for s.Scan() {
			fields := strings.Fields(s.Text())
			if len(fields) < 2 {
				continue
			}
			kb, _ := strconv.ParseUint(fields[1], 10, 64)
			switch fields[0] {
			case "MemTotal:":
				total = kb * 1024
			case "MemAvailable:":
				available = kb * 1024
			}
		}
		f.Close()
	}
	return total, available
}
