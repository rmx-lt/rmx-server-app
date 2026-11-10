package protocol

import "strings"

// MQTT topic layout (<prefix> is "mower" in production). A client puts its own
// id in the topic (mower/<id>/...), so a broker ACL scopes each login to
// mower/<its username>/#.
//
//   - <prefix>/<client-id>/req: client to server, payload RequestEnvelope
//   - <prefix>/<client-id>/res: server to client, payload ResponseEnvelope
//   - <prefix>/<client-id>/fw/req: client to server, firmware request (JSON)
//   - <prefix>/<client-id>/fw/chunk: server to client, one firmware chunk (binary)
//   - <prefix>/<client-id>/fw/res: server to client, firmware info or error (JSON)
//   - <prefix>/events/records: server to all, payload ChangeEvent
//   - <prefix>/status/server: retained "online" / "offline" (last will)
//
// "events" and "status" are therefore not usable as client ids.

// RequestTopic is where a client publishes its requests.
func RequestTopic(prefix, clientID string) string { return prefix + "/" + clientID + "/req" }

// RequestFilter is a subscription filter that matches every client's requests.
func RequestFilter(prefix string) string { return prefix + "/+/req" }

// ResponseTopic is where the server answers a client.
func ResponseTopic(prefix, clientID string) string { return prefix + "/" + clientID + "/res" }

// EventsTopic is where the server publishes every change.
func EventsTopic(prefix string) string { return prefix + "/events/records" }

// StatusTopic carries the retained "online" / "offline" of the server.
func StatusTopic(prefix string) string { return prefix + "/status/server" }

// FirmwareRequestTopic is where a device asks for a firmware chunk or for
// the image description. wiki Server-App, section "Firmware over MQTT".
func FirmwareRequestTopic(prefix, clientID string) string {
	return prefix + "/" + clientID + "/fw/req"
}

// FirmwareRequestFilter matches every device's firmware requests.
func FirmwareRequestFilter(prefix string) string { return prefix + "/+/fw/req" }

// FirmwareChunkTopic carries one binary chunk.
func FirmwareChunkTopic(prefix, clientID string) string {
	return prefix + "/" + clientID + "/fw/chunk"
}

// FirmwareResponseTopic carries a firmware info object or a JSON error.
func FirmwareResponseTopic(prefix, clientID string) string {
	return prefix + "/" + clientID + "/fw/res"
}

// ParseFirmwareRequestTopic extracts the device id from a firmware request
// topic. It returns false for any other topic, or for an id that is not a
// single plain topic level. "events" and "status" are not device ids.
func ParseFirmwareRequestTopic(prefix, topic string) (string, bool) {
	rest, ok := strings.CutPrefix(topic, prefix+"/")
	if !ok {
		return "", false
	}
	id, ok := strings.CutSuffix(rest, "/fw/req")
	if !ok || !ValidClientID(id) || id == "events" || id == "status" {
		return "", false
	}
	return id, true
}

// ParseRequestTopic extracts the client id from a request topic. It returns
// false for any other topic, or for an id that is not a single plain topic level.
func ParseRequestTopic(prefix, topic string) (string, bool) {
	rest, ok := strings.CutPrefix(topic, prefix)
	if !ok {
		return "", false
	}
	rest, ok = strings.CutPrefix(rest, "/")
	if !ok {
		return "", false
	}
	id, ok := strings.CutSuffix(rest, "/req")
	if !ok || !ValidClientID(id) || id == "events" || id == "status" {
		return "", false
	}
	return id, true
}

// ValidClientID reports whether id is 1 to 64 characters of [A-Za-z0-9_-], so
// the id is safe inside a topic.
func ValidClientID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}
