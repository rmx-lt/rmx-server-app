package server

import (
	"context"
	"net/http"
	"os"
	"path"
	"time"

	"github.com/rmx-lt/rmx-backend-probe/internal/apperr"
	"github.com/rmx-lt/rmx-backend-probe/internal/auth"
	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
)

// Handler returns the HTTP routes. Everything lives under /probe, because
// Caddy forwards api.rmx.lt/probe/* without stripping the prefix.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Fail closed: data and live connections go through `protected`, and every
	// route there needs a valid session. Only the routes registered plainly
	// work without one: health (status only, for the deploy script and
	// monitoring), login/logout, and the client's static files (the same code
	// as in the public repository, no data).
	protected := func(h http.HandlerFunc) http.Handler { return s.auth.RequireSession(h) }

	mux.HandleFunc("GET /probe/health", s.health)
	mux.HandleFunc("POST /probe/api/auth/login", s.auth.HandleLogin)
	mux.HandleFunc("POST /probe/api/auth/logout", s.auth.HandleLogout)

	mux.Handle("GET /probe/api/auth/me", protected(auth.HandleMe))
	mux.Handle("POST /probe/api/auth/logout-all", protected(s.auth.HandleLogoutAll))
	// The handshake is a normal GET with the cookie, checked here before the
	// upgrade. That's what fixes iPhones: WebKit sends cookies on WebSocket
	// handshakes (but not basic-auth credentials).
	mux.Handle("GET /probe/ws", protected(s.handleWS))

	// Unknown API paths are a plain 404, not the app's index.html.
	mux.HandleFunc("/probe/api/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) })
	mux.HandleFunc("GET /probe", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/probe/", http.StatusPermanentRedirect)
	})
	// The built client (production only). Unknown paths fall back to
	// index.html so client-side routes still load the app.
	if s.cfg.StaticDir != "" {
		mux.Handle("/probe/", staticFiles(s.cfg.StaticDir))
	}

	// CSRF: state-changing requests and WebSocket handshakes only from our own pages.
	return auth.CheckOrigin(s.cfg.AllowedOrigins, mux)
}

// health answers 200 when the database answers and the MQTT connection is up, else 503.
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	var one int
	dbUp := s.pool.QueryRow(ctx, "SELECT 1").Scan(&one) == nil
	mqttUp := s.mqtt.isConnected()
	ok := dbUp && mqttUp
	body := protocol.Health{Status: "degraded", DB: dbUp, MQTT: mqttUp, Version: Version}
	status := http.StatusServiceUnavailable
	if ok {
		body.Status = "ok"
		status = http.StatusOK
	}
	apperr.WriteJSON(w, status, body)
}

// staticFiles serves the built client from dir under /probe/. A path that is
// not a file gets index.html, so client-side routes load the app.
func staticFiles(dir string) http.Handler {
	root, err := os.OpenRoot(dir)
	if err != nil {
		// Reported when the first request comes; the API still works.
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			apperr.Write(w, apperr.Internal(err))
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		name := path.Clean("/" + r.URL.Path[len("/probe/"):])[1:]
		if name == "" {
			name = "index.html"
		}
		f, err := root.Open(name)
		if err == nil {
			if info, statErr := f.Stat(); statErr != nil || info.IsDir() {
				f.Close()
				err = os.ErrNotExist
			}
		}
		if err != nil {
			name = "index.html"
			if f, err = root.Open(name); err != nil {
				http.NotFound(w, r)
				return
			}
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeContent(w, r, name, info.ModTime(), f)
	})
}
