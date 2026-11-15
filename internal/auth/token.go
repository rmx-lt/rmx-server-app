package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
)

// CookieName is the session cookie's name.
//
// __Host-: browsers accept this cookie only with Secure, only from an HTTPS
// page, only with Path=/ and only without Domain. So a plain-HTTP response
// can never set or overwrite it, and it belongs to this host alone: no other
// host under rmx.lt can set a cookie of this name that would be sent here.
// The app has its own host (app.rmx.lt), so Path=/ costs nothing. A cookie
// of our own name sent twice is still rejected (see SessionCookie).
const CookieName = "__Host-app_session"

// CookiePath is "/", as the __Host- prefix requires: the whole host is the app.
const CookiePath = "/"

// tokenBytes: 32 random bytes = 256 bits, written as 64 lower-case hex characters.
const tokenBytes = 32

// SessionToken is the secret in the cookie. Whoever has it is logged in, so it
// is never logged, and only its hash goes into the database.
type SessionToken string

// String hides the token from log lines.
func (SessionToken) String() string { return "SessionToken(..)" }

// GoString hides the token from %#v.
func (SessionToken) GoString() string { return "SessionToken(..)" }

// NewToken makes a new token from the operating system's random number generator.
func NewToken() SessionToken {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		panic("the OS random number generator failed: " + err.Error())
	}
	return SessionToken(hex.EncodeToString(b))
}

// ParseToken accepts only the exact shape we generate, so junk never reaches the database.
func ParseToken(value string) (SessionToken, bool) {
	if len(value) != tokenBytes*2 {
		return "", false
	}
	for i := 0; i < len(value); i++ {
		if c := value[i]; !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return "", false
		}
	}
	return SessionToken(value), true
}

// Hash is what the database stores and looks up: SHA-256 of the token. A fast
// hash is enough because the token is random (no dictionary to try), unlike
// passwords, which need a slow hash.
func (t SessionToken) Hash() []byte {
	sum := sha256.Sum256([]byte(string(t)))
	return sum[:]
}

// CookieState says what the request's cookies hold for our session cookie.
type CookieState int

const (
	// CookieMissing: no cookie of our name.
	CookieMissing CookieState = iota
	// CookieFound: exactly one cookie with our name and a well-formed value.
	CookieFound
	// CookieInvalid: malformed, or sent more than once. The __Host- prefix
	// should make a second cookie of our name impossible; if one arrives
	// anyway (a browser that ignores the prefix), rather than guess which one
	// is ours (and maybe log the user into someone else's account), treat the
	// request as logged out.
	CookieInvalid
)

// SessionCookie finds our session cookie in all Cookie headers (HTTP/2 may send several).
func SessionCookie(h http.Header) (SessionToken, CookieState) {
	count := 0
	var found SessionToken
	var ok bool
	for _, line := range h.Values("Cookie") {
		for _, pair := range strings.Split(line, ";") {
			name, val, has := strings.Cut(strings.TrimSpace(pair), "=")
			if !has || name != CookieName {
				continue
			}
			count++
			found, ok = ParseToken(strings.Trim(val, `"`))
		}
	}
	switch {
	case count == 0:
		return "", CookieMissing
	case count == 1 && ok:
		return found, CookieFound
	}
	return "", CookieInvalid
}

// SetCookie is the Set-Cookie header for a new session. Each attribute and why:
//   - HttpOnly: page JavaScript can't read it, so an XSS bug can't steal it.
//   - Secure: sent over HTTPS only (required by the __Host- prefix).
//   - SameSite=Strict: never sent on requests started by another site, which
//     blocks CSRF in all current browsers. Lax would also send it when someone
//     follows a link here from another site; we don't need that, because the
//     page itself is public and only its own API calls (same-site) need it.
//   - Path=/, no Domain: required by the __Host- prefix; sent to this host only.
//   - Max-Age: the browser keeps it until the absolute timeout; the server
//     enforces the idle timeout on its own.
func SetCookie(t SessionToken, maxAgeSecs int) string {
	return CookieName + "=" + string(t) + "; Path=" + CookiePath + "; Max-Age=" + strconv.Itoa(maxAgeSecs) +
		"; HttpOnly; Secure; SameSite=Strict"
}

// ClearCookie is the Set-Cookie header that makes the browser delete the cookie.
func ClearCookie() string {
	return CookieName + "=; Path=" + CookiePath + "; Max-Age=0; HttpOnly; Secure; SameSite=Strict"
}
