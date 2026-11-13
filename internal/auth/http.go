package auth

import (
	"context"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/clientip"
	"github.com/rmx-lt/rmx-server-app/internal/protocol"
)

// The HTTP side of the login: the /app/api/auth/* handlers, the session
// middleware, and the Origin check against cross-site requests.

type userKey struct{}

// UserFrom returns the user RequireSession put into the request context.
func UserFrom(ctx context.Context) (CurrentUser, bool) {
	u, ok := ctx.Value(userKey{}).(CurrentUser)
	return u, ok
}

// Responses that carry session data must not be stored by any cache.
func noStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }

// HandleLogin handles POST /app/api/auth/login with {"username", "password"}:
// 200 + Set-Cookie + Me; 401 for a wrong username or password (the same
// answer for both, so it doesn't reveal which names exist); 429 + Retry-After
// after too many failures.
func (s *Service) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var body protocol.LoginRequest
	if e := apperr.ReadJSON(w, r, &body); e != nil {
		apperr.Write(w, e)
		return
	}
	ip := clientip.Of(r)
	// Every login gets a new session id, and an old one sent along ends now.
	// (Reusing an id from before the login would allow "session fixation".)
	if old, state := SessionCookie(r.Header); state == CookieFound {
		if err := s.Logout(r.Context(), old.Hash()); err != nil {
			apperr.Write(w, apperr.DB(err))
			return
		}
	}
	token, user, err := s.Login(r.Context(), body.Username, body.Password, ip, r.UserAgent())
	if err != nil {
		// No username in the log: people sometimes type a password there.
		slog.Warn("login failed", "ip", ip, "error", err)
		apperr.Write(w, err)
		return
	}
	slog.Info("login", "username", user.Username, "ip", ip)
	w.Header().Add("Set-Cookie", SetCookie(token, int(AbsoluteTimeout.Seconds())))
	noStore(w)
	apperr.WriteJSON(w, http.StatusOK, protocol.Me{Username: user.Username})
}

// HandleLogout handles POST /app/api/auth/logout: ends this session. Always 204
// and clears the cookie, even if there was no valid session.
func (s *Service) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if token, state := SessionCookie(r.Header); state == CookieFound {
		if err := s.Logout(r.Context(), token.Hash()); err != nil {
			apperr.Write(w, apperr.DB(err))
			return
		}
	}
	loggedOut(w)
}

// HandleLogoutAll handles POST /app/api/auth/logout-all: ends every session of this user.
func (s *Service) HandleLogoutAll(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFrom(r.Context())
	n, err := s.LogoutEverywhere(r.Context(), user.UserID)
	if err != nil {
		apperr.Write(w, apperr.DB(err))
		return
	}
	slog.Info("logged out everywhere", "username", user.Username, "sessions", n)
	loggedOut(w)
}

// HandleMe handles GET /app/api/auth/me: who is logged in (401 if nobody). The
// client asks this at start to choose between the login form and the app.
func HandleMe(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFrom(r.Context())
	apperr.WriteJSON(w, http.StatusOK, protocol.Me{Username: user.Username})
}

func loggedOut(w http.ResponseWriter) {
	w.Header().Add("Set-Cookie", ClearCookie())
	noStore(w)
	w.WriteHeader(http.StatusNoContent)
}

// RequireSession is the middleware for every protected route: 401 without a
// valid session, otherwise it puts the CurrentUser into the request context.
func (s *Service) RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, state := SessionCookie(r.Header)
		var user *CurrentUser
		if state == CookieFound {
			var err error
			if user, err = s.Validate(r.Context(), token.Hash(), true); err != nil {
				apperr.Write(w, apperr.DB(err))
				return
			}
		}
		if user == nil {
			// A cookie that no longer works (expired, logged out, forged): tell
			// the browser to drop it.
			if state != CookieMissing {
				w.Header().Add("Set-Cookie", ClearCookie())
			}
			apperr.Write(w, apperr.Unauthorized())
			return
		}
		noStore(w)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, *user)))
	})
}

// CheckOrigin is the middleware for everything under /app: requests that
// change something (any method but GET/HEAD/OPTIONS) and WebSocket handshakes
// must come from one of the allowed origins, else 403.
//
// Why, on top of SameSite=Strict: SameSite works per site (rmx.lt), so it
// doesn't stop a page on another rmx.lt subdomain, and older browsers ignore
// it. Browsers always send Origin on these requests and on WebSocket
// handshakes, and a page can't fake it. WebSockets matter most: they are not
// covered by CORS, so without this check any website could open one to us with
// the user's cookie ("cross-site WebSocket hijacking"). No Origin at all is
// refused too: no browser omits it here, so only non-browser clients would,
// and they have no business sending our cookie.
func CheckOrigin(allowed []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if needsOriginCheck(r) && !originAllowed(r.Header, allowed) {
			slog.Warn("request from a foreign origin refused", "origin", r.Header.Values("Origin"), "path", r.URL.Path)
			apperr.Write(w, apperr.Forbidden("cross-origin request refused"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func needsOriginCheck(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return r.Header.Get("Upgrade") != ""
	}
	return true
}

func originAllowed(h http.Header, allowed []string) bool {
	origins := h.Values("Origin")
	if len(origins) != 1 {
		return false
	}
	return slices.ContainsFunc(allowed, func(a string) bool { return strings.EqualFold(a, origins[0]) })
}
