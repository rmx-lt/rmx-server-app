package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// What a board keeps across restarts (§4.1: the boot counter; §6.5: the
// running image and the update command, whose id survives the restart).
// Saved to a small JSON file so that restarting devsim is a reboot of the
// simulated mower; with no path it lives in memory only.

type pendingOTA struct {
	ID       string `json:"id"`
	Cmd      string `json:"cmd"`
	Version  string `json:"version"`
	Previous string `json:"previous"`
	// Rolled: the new image did not confirm, the old one runs again.
	Rolled bool `json:"rolled"`
}

type boardStore struct {
	Boot       int         `json:"boot"`
	Firmware   string      `json:"firmware"`
	Previous   *string     `json:"previous"`
	Partition  string      `json:"partition"`
	PendingOTA *pendingOTA `json:"pending_ota,omitempty"`
	// SpeedLimit holds the limits the server has set (autopilot); a limit not in it has its default.
	SpeedLimit map[string]float64 `json:"speed_limit,omitempty"`
}

type storeFile struct {
	Gateway   boardStore `json:"gateway"`
	Autopilot boardStore `json:"autopilot"`
}

type store struct {
	path string
	data storeFile
}

func loadStore(path string) *store {
	s := &store{path: path}
	if path != "" {
		if b, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(b, &s.data)
		}
	}
	return s
}

func (s *store) save() {
	if s.path == "" {
		return
	}
	b, _ := json.MarshalIndent(s.data, "", "  ")
	_ = os.MkdirAll(filepath.Dir(s.path), 0o755)
	_ = os.WriteFile(s.path, b, 0o644)
}

// start advances a board's record for a start: boot + 1. Firmware stays empty
// until an update ran; the flag's version is used until then.
func (b *boardStore) start() {
	b.Boot++
	if b.Partition == "" {
		b.Partition = "ota_0"
	}
}

func (b *boardStore) version(flag string) string {
	if b.Firmware != "" {
		return b.Firmware
	}
	return flag
}
