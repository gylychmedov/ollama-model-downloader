package sysinfo

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

var vmStatLine = regexp.MustCompile(`^Pages (free|inactive|speculative|purgeable):\s+(\d+)`)

func sysctl(name string) string {
	out, _ := exec.Command("sysctl", "-n", name).Output()
	return strings.TrimSpace(string(out))
}

var memTotal = sync.OnceValue(func() uint64 {
	n, _ := strconv.ParseUint(sysctl("hw.memsize"), 10, 64)
	return n
})

func collectPlatform(info *Info) {
	info.OS = "macOS"
	info.CPU = sysctl("machdep.cpu.brand_string")
	if out, err := exec.Command("sw_vers", "-productVersion").Output(); err == nil {
		info.OSVersion = strings.TrimSpace(string(out))
	}
}

func memory() (total, available uint64) {
	total = memTotal()
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return total, 0
	}
	lines := strings.Split(string(out), "\n")
	page := uint64(4096)
	if f := strings.Fields(lines[0]); len(f) >= 2 {
		for i, w := range f {
			if w == "of" && i+1 < len(f) {
				if n, err := strconv.ParseUint(f[i+1], 10, 64); err == nil {
					page = n
				}
			}
		}
	}
	for _, l := range lines[1:] {
		if m := vmStatLine.FindStringSubmatch(l); m != nil {
			n, _ := strconv.ParseUint(m[2], 10, 64)
			available += n * page
		}
	}
	return total, available
}
