//go:build integration

// The firmware domain: a device downloads an image over MQTT.

package integration

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/firmware"
)

func TestFirmwareChunksResumeAndSHA256(t *testing.T) {
	dir := t.TempDir()
	// 9000 bytes at the default 4096-byte chunk: 4096 + 4096 + 808.
	image := bytes.Repeat([]byte("fw-image-"), 1000)
	if err := os.WriteFile(dir+"/app.bin", image, 0o644); err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256(image)

	pool := newDatabase(t)
	app := startAppOptions(t, pool, appOptions{firmwareDir: dir})
	dev := app.mqttConnect()
	chunkTopic := dev.topic(firmware.SuffixChunk)
	resTopic := dev.topic(firmware.SuffixResponse)
	dev.subscribe(chunkTopic, resTopic)

	dev.publish(dev.topic(firmware.SuffixRequest), []byte(`{"request_id":"info","op":"info","file":"app.bin"}`))
	info := decode[firmware.Info](t, dev.nextOn(resTopic))
	eq(t, info.RequestID, "info")
	eq(t, info.File, "app.bin")
	eq(t, info.Size, int64(len(image)))
	eq(t, info.ChunkSize, firmware.DefaultChunkBytes)
	eq(t, info.Chunks, uint32(3))
	eq(t, info.SHA256, hex.EncodeToString(want[:]))

	// Resume from the middle chunk, then the tail, then the first.
	got := make([]byte, len(image))
	for _, index := range []uint32{1, 2, 0} {
		body, _ := json.Marshal(map[string]any{"request_id": fmt.Sprintf("c%d", index), "file": "app.bin", "chunk": index})
		dev.publish(dev.topic(firmware.SuffixRequest), body)
		frame, err := firmware.ParseFrame(dev.nextOn(chunkTopic))
		if err != nil {
			t.Fatal(err)
		}
		eq(t, frame.ChunkIndex, index)
		eq(t, frame.ChunkCount, uint32(3))
		eq(t, frame.ImageSize, uint32(len(image)))
		if frame.IDHash != firmware.RequestIDHash(fmt.Sprintf("c%d", index)) {
			t.Fatalf("chunk %d request id hash %x", index, frame.IDHash)
		}
		if frame.SHA256 != want {
			t.Fatalf("chunk %d sha256 %x", index, frame.SHA256)
		}
		off := int(index) * firmware.DefaultChunkBytes
		copy(got[off:], frame.Payload)
	}
	if !bytes.Equal(got, image) {
		t.Fatal("assembled image differs from the file")
	}
	if sha256.Sum256(got) != want {
		t.Fatal("assembled sha256 differs")
	}
	t.Logf("resumed %d bytes from chunks 1, 2, 0; sha256 %x", len(got), want)

	ask := func(body string) firmware.ErrorMessage {
		t.Helper()
		dev.publish(dev.topic(firmware.SuffixRequest), []byte(body))
		return decode[firmware.ErrorMessage](t, dev.nextOn(resTopic))
	}
	missing := ask(`{"request_id":"e1","file":"missing.bin","chunk":0}`)
	eq(t, missing.Error.Code, "not_found")
	badName := ask(`{"request_id":"e2","file":"../app.bin","chunk":0}`)
	eq(t, badName.RequestID, "e2")
	eq(t, badName.Error.Code, "bad_request")
	past := ask(`{"request_id":"e3","file":"app.bin","chunk":3}`)
	eq(t, past.Error.Code, "bad_request")
	eq(t, past.Error.Message, "chunk is past the end of the file")
}
