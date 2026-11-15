package mqtt

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

func TestTreeFilter(t *testing.T) {
	if TreeFilter("mower", "gateway") != "mower/+/gateway/#" {
		t.Fatal(TreeFilter("mower", "gateway"))
	}
}

// Messages under a tree root reach their handler one at a time, in the order
// they arrived; the other messages are not held up by them.
func TestTreeMessagesAreHandledInOrder(t *testing.T) {
	c := New(config.MQTT{TopicPrefix: "mower"})
	var mu sync.Mutex
	var got []string
	done := make(chan struct{})
	c.HandleTree("gateway", func(_ context.Context, device core.DeviceID, suffix string, payload []byte) {
		mu.Lock()
		defer mu.Unlock()
		got = append(got, fmt.Sprintf("%s %s %s", device, suffix, payload))
		if len(got) == 200 {
			close(done)
		}
	})
	c.workers.Add(1)
	go c.runOrdered()
	defer func() { c.stopWorkers(); c.workers.Wait() }()

	for i := 0; i < 200; i++ {
		c.receive("mower/m1/gateway/telemetry", []byte(fmt.Sprint(i)))
	}
	c.receive("mower/m1/other/x", []byte("ignored"))
	c.receive("other/m1/gateway/state", []byte("ignored"))
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("handled %d of 200", len(got))
	}
	for i, g := range got {
		if want := fmt.Sprintf("m1 gateway/telemetry %d", i); g != want {
			t.Fatalf("message %d: %q, want %q", i, g, want)
		}
	}
}

func TestTreeAndSuffixHandlersSideBySide(t *testing.T) {
	c := New(config.MQTT{TopicPrefix: "mower"})
	exact := make(chan string, 1)
	tree := make(chan string, 1)
	c.Handle("fw/req", func(_ context.Context, _ core.DeviceID, p []byte) { exact <- string(p) })
	c.HandleTree("autopilot", func(_ context.Context, _ core.DeviceID, s string, _ []byte) { tree <- s })
	c.workers.Add(1)
	go c.runOrdered()
	defer func() { c.stopWorkers(); c.workers.Wait() }()

	c.receive("mower/m1/fw/req", []byte("a"))
	c.receive("mower/m1/autopilot/metrics/battery", nil)
	for _, ch := range []chan string{exact, tree} {
		select {
		case <-ch:
		case <-time.After(5 * time.Second):
			t.Fatal("a message was not handled")
		}
	}
}
