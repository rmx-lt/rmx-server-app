package mqtt

import (
	"strings"

	"github.com/rmx-lt/rmx-server-app/internal/core"
)

// Topic grammar (<prefix> is "mower" in production). A device puts its own
// id in the topic, so a broker ACL scopes each login to <prefix>/<its username>/#.
//
//   - <prefix>/<device>/<suffix>: a device's topics. Each domain owns its
//     suffixes (firmware: fw/req, fw/chunk, fw/res) in its mqtt.go.
//   - <prefix>/status/server: retained "online" / "offline" (last will).
//
// "status" is therefore not a device id (core.ReservedDeviceID).

// StatusTopic carries the retained "online" / "offline" of the server.
func StatusTopic(prefix string) string { return prefix + "/status/server" }

// DeviceTopic is <prefix>/<device>/<suffix>.
func DeviceTopic(prefix string, device core.DeviceID, suffix string) string {
	return prefix + "/" + string(device) + "/" + suffix
}

// DeviceFilter matches suffix for every device: <prefix>/+/<suffix>.
func DeviceFilter(prefix, suffix string) string { return prefix + "/+/" + suffix }

// ParseDeviceTopic splits <prefix>/<device>/<suffix>. It returns false for
// another prefix, an empty suffix, or a device level that is not a device id.
func ParseDeviceTopic(prefix, topic string) (core.DeviceID, string, bool) {
	rest, ok := strings.CutPrefix(topic, prefix+"/")
	if !ok {
		return "", "", false
	}
	level, suffix, ok := strings.Cut(rest, "/")
	if !ok || suffix == "" {
		return "", "", false
	}
	device, ok := core.ParseDeviceID(level)
	if !ok {
		return "", "", false
	}
	return device, suffix, true
}
