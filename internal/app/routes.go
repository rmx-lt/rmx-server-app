package app

import (
	"context"
	"net/http"
	"os"
	"path"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/auth"
	"github.com/rmx-lt/rmx-server-app/internal/buildinfo"
	"github.com/rmx-lt/rmx-server-app/internal/db"
	"github.com/rmx-lt/rmx-server-app/internal/httpx"
)

// handler returns the HTTP routes, behind the Origin check.
func (a *app) handler() http.Handler {
	// CSRF: state-changing requests and WebSocket handshakes only from our own pages.
	return auth.CheckOrigin(a.cfg.AllowedOrigins, a.router())
}

// router registers every route. Everything lives under /app, because Caddy
// forwards api.rmx.lt/app/* without stripping the prefix.
//
// Fail closed: data and live connections go in the Protected group, where
// every route needs a valid session. Only the Public routes work without one:
// health (status only, for the deploy script and monitoring), login/logout,
// and the web app's static files (the same code as in the public repository,
// no data). TestPublicRoutes holds the allow-list.
func (a *app) router() *httpx.Router {
	r := httpx.NewRouter(a.auth.RequireSession)

	r.Public().HandleFunc("GET /app/health", a.health)
	a.auth.Routes(r)
	// The handshake is a normal GET with the cookie, checked before the
	// upgrade. That's what fixes iPhones: WebKit sends cookies on WebSocket
	// handshakes (but not basic-auth credentials).
	r.Protected().Handle("GET /app/ws", a.ws)

	// Unknown API paths are a plain 404, not the app's index.html.
	r.Public().HandleFunc("/app/api/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) })
	r.Public().HandleFunc("GET /app", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/app/", http.StatusPermanentRedirect)
	})
	// The built web app (production only). Unknown paths fall back to
	// index.html so client-side routes still load the app.
	if a.cfg.StaticDir != "" {
		r.Public().Handle("/app/", staticFiles(a.cfg.StaticDir))
	}
	return r
}

// health answers 200 when the database answers and the MQTT connection is up, else 503.
func (a *app) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	dbUp := db.Ping(ctx, a.pool) == nil
	mqttUp := a.mqtt.Connected()
	ok := dbUp && mqttUp
	body := api.Health{Status: "degraded", DB: dbUp, MQTT: mqttUp, Version: buildinfo.Version}
	status := http.StatusServiceUnavailable
	if ok {
		body.Status = "ok"
		status = http.StatusOK
	}
	httpx.WriteJSON(w, status, body)
}

// staticFiles serves the built web app from dir under /app/. A path that is
// not a file gets index.html, so client-side routes load the app.
func staticFiles(dir string) http.Handler {
	root, err := os.OpenRoot(dir)
	if err != nil {
		// Reported when the first request comes; the API still works.
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			httpx.WriteError(w, apperr.Internal(err))
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		name := path.Clean("/" + r.URL.Path[len("/app/"):])[1:]
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
