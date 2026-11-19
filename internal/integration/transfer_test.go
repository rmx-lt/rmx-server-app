//go:build integration

// The transfer domain: a board downloads a firmware image and a path file over
// MQTT, side by side (wiki Mower-Protocol §12).
//
// Covers: transfer

package integration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/transfer"
)

// download fetches a whole file from one topic set the way a board does: one
// request open at a time, chunk by chunk, checking every header.
func (d *mqttDevice) download(set transfer.Set, file string) []byte {
	d.t.Helper()
	var out []byte
	var count uint32 = 1
	for index := uint32(0); index < count; index++ {
		id := fmt.Sprintf("%s-%d", strings.ReplaceAll(string(set), "/", "-"), index)
		body, _ := json.Marshal(map[string]any{"request_id": id, "file": file, "chunk": index})
		d.publish(d.topic(set.Request()), body)
		frame, err := transfer.ParseFrame(d.nextOn(d.topic(set.Chunk())))
		if err != nil {
			d.t.Fatal(err)
		}
		if frame.IDHash != transfer.RequestIDHash(id) || frame.ChunkIndex != index {
			d.t.Fatalf("%s chunk %d: answer is for another request", set, index)
		}
		count = frame.ChunkCount
		out = append(out, frame.Payload...)
		if index == count-1 && frame.SHA256 != sha256.Sum256(out) {
			d.t.Fatalf("%s: the file hash in the chunks is not the hash of the file", set)
		}
	}
	return out
}

func TestTransferServesFirmwareAndPathFilesSideBySide(t *testing.T) {
	t.Parallel()
	fw := t.TempDir()
	for _, sub := range []string{"gateway", "autopilot"} {
		if err := os.Mkdir(filepath.Join(fw, sub), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// 9000 bytes: 4096 + 4096 + 808 chunks.
	gwImage := bytes.Repeat([]byte("gateway-image-"), 650)
	apImage := bytes.Repeat([]byte("autopilot-"), 900)
	path := []byte(`{"path":"j-1","segments":[{"type":"transit","points":[[54.1,25.1]]}]}`)
	for file, body := range map[string][]byte{
		filepath.Join(fw, "gateway", "1.0.0.bin"):   gwImage,
		filepath.Join(fw, "autopilot", "1.0.0.bin"): apImage,
	} {
		if err := os.WriteFile(file, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pool := newDatabase(t)
	if err := transfer.StorePath(context.Background(), pool, "j-1", path); err != nil {
		t.Fatal(err)
	}
	app := startAppOptions(t, pool, appOptions{firmwareDir: fw})
	dev := app.mqttConnect()
	for _, set := range transfer.Sets {
		dev.subscribe(dev.topic(set.Chunk()), dev.topic(set.Response()))
	}

	// A path file and a firmware image side by side: two sets, requests open at once.
	for _, set := range []transfer.Set{transfer.AutopilotPath, transfer.AutopilotFirmware} {
		body, _ := json.Marshal(map[string]any{"request_id": "first-" + strings.ReplaceAll(string(set), "/", "-"), "file": map[bool]string{true: "j-1.json", false: "1.0.0.bin"}[set == transfer.AutopilotPath], "chunk": 0})
		dev.publish(dev.topic(set.Request()), body)
	}
	for _, set := range []transfer.Set{transfer.AutopilotPath, transfer.AutopilotFirmware} {
		frame, err := transfer.ParseFrame(dev.nextOn(dev.topic(set.Chunk())))
		if err != nil {
			t.Fatal(err)
		}
		if frame.IDHash != transfer.RequestIDHash("first-"+strings.ReplaceAll(string(set), "/", "-")) {
			t.Fatalf("%s: chunk answers another request", set)
		}
	}

	if got := dev.download(transfer.AutopilotPath, "j-1.json"); !bytes.Equal(got, path) {
		t.Fatal("path file differs")
	}
	if got := dev.download(transfer.AutopilotFirmware, "1.0.0.bin"); !bytes.Equal(got, apImage) {
		t.Fatal("autopilot image differs")
	}
	if got := dev.download(transfer.GatewayFirmware, "1.0.0.bin"); !bytes.Equal(got, gwImage) {
		t.Fatal("gateway image differs")
	}
	t.Logf("path %d bytes, autopilot image %d bytes and gateway image %d bytes downloaded, hashes match", len(path), len(apImage), len(gwImage))

	// The sets are kept apart: the path file is not in a firmware set.
	ask := func(set transfer.Set, body string) transfer.ErrorMessage {
		t.Helper()
		dev.publish(dev.topic(set.Request()), []byte(body))
		return decode[transfer.ErrorMessage](t, dev.nextOn(dev.topic(set.Response())))
	}
	eq(t, ask(transfer.AutopilotFirmware, `{"request_id":"e1","file":"j-1.json","chunk":0}`).Error.Code, "not_found")
	eq(t, ask(transfer.AutopilotPath, `{"request_id":"e2","file":"1.0.0.bin","chunk":0}`).Error.Code, "not_found")
	// A path id that is not in the table is not_found, as a missing file is (§12.3).
	missing := ask(transfer.AutopilotPath, `{"request_id":"e5","file":"j-404.json","chunk":0}`)
	eq(t, missing.Error.Code, "not_found")
	eq(t, missing.RequestID, "e5")
	bad := ask(transfer.GatewayFirmware, `{"request_id":"e3","file":"../autopilot/1.0.0.bin","chunk":0}`)
	eq(t, bad.Error.Code, "bad_request")
	eq(t, bad.RequestID, "e3")
	eq(t, ask(transfer.GatewayFirmware, `{"request_id":"e4","file":"1.0.0.bin","chunk":3}`).Error.Code, "bad_request")
}
