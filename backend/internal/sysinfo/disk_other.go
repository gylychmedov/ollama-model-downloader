//go:build !darwin && !linux

package sysinfo

func diskSpace(string) (uint64, uint64) { return 0, 0 }
