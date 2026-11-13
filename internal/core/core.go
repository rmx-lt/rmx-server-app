// Package core holds the small types every layer shares: who the user is,
// which device a message is about, and the context accessors for them. It
// imports nothing internal.
package core

import "context"

// UserID is a row id in the users table.
type UserID int64

// CurrentUser is the user behind a request, put into the request context by
// the session middleware (see WithUser).
type CurrentUser struct {
	UserID   UserID
	Username string
	// SessionHash is the SHA-256 of this request's session token (for logout and the WebSocket).
	SessionHash []byte
}

type userKey struct{}

// WithUser returns ctx carrying u.
func WithUser(ctx context.Context, u CurrentUser) context.Context {
	return context.WithValue(ctx, userKey{}, u)
}

// UserFrom returns the user WithUser put into ctx.
func UserFrom(ctx context.Context) (CurrentUser, bool) {
	u, ok := ctx.Value(userKey{}).(CurrentUser)
	return u, ok
}

// DeviceID is a device's id: its MQTT client id and the topic level
// <prefix>/<device>/... it publishes under.
type DeviceID string

// ReservedDeviceID is the topic level of the server's own status
// (<prefix>/status/server), so it is not a device id.
const ReservedDeviceID DeviceID = "status"

// ParseDeviceID accepts a valid id (see ValidID) that is not ReservedDeviceID.
func ParseDeviceID(s string) (DeviceID, bool) {
	if !ValidID(s) || DeviceID(s) == ReservedDeviceID {
		return "", false
	}
	return DeviceID(s), true
}

// ValidID reports whether id is 1 to 64 characters of [A-Za-z0-9_-], so the
// id is safe inside an MQTT topic. Device ids and firmware request ids follow it.
func ValidID(id string) bool {
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
