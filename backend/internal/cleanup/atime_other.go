//go:build !linux && !darwin

package cleanup

import (
	"os"
	"time"
)

func accessTime(os.FileInfo) time.Time { return time.Time{} }
