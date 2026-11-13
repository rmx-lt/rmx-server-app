package mqtt

import (
	"strings"
	"testing"
)

func TestTopicGrammar(t *testing.T) {
	if id, suffix, ok := ParseDeviceTopic("mower", "mower/mower-01/fw/req"); !ok || id != "mower-01" || suffix != "fw/req" {
		t.Fatal(id, suffix, ok)
	}
	if DeviceFilter("mower", "fw/req") != "mower/+/fw/req" ||
		DeviceTopic("mower", "mower-01", "fw/chunk") != "mower/mower-01/fw/chunk" ||
		StatusTopic("mower") != "mower/status/server" {
		t.Fatal("topic shape")
	}
	for _, bad := range []string{
		"mower/mower-01",
		"mower/mower-01/",
		"mower//fw/req",
		"mower/status/fw/req",
		"mower/status/server",
		"mower/" + strings.Repeat("a", 65) + "/fw/req",
		"mower/a+b/fw/req",
		"mowerx/a/fw/req",
		"other/a/fw/req",
	} {
		if id, suffix, ok := ParseDeviceTopic("mower", bad); ok {
			t.Errorf("%s parsed as %s %s", bad, id, suffix)
		}
	}
}
