package firmware

import "testing"

func TestFirmwareGateOneInFlight(t *testing.T) {
	var g gate
	if !g.acquire("mower-01") {
		t.Fatal("first acquire")
	}
	if g.acquire("mower-01") {
		t.Fatal("a second request for the same device was accepted")
	}
	if !g.acquire("mower-02") {
		t.Fatal("another device was blocked")
	}
	g.release("mower-01")
	if !g.acquire("mower-01") {
		t.Fatal("acquire after release")
	}
	g.release("mower-01")
	g.release("mower-02")
	g.release("mower-02") // a spare release must not panic
}
