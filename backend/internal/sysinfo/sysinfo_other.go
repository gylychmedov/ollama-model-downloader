//go:build !darwin && !linux

package sysinfo

func collectPlatform(*Info) {}

func memory() (uint64, uint64) { return 0, 0 }
