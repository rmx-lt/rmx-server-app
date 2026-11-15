package app

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/auth"
	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/mower"
	"github.com/rmx-lt/rmx-server-app/internal/planning"
	"github.com/rmx-lt/rmx-server-app/internal/ws"
)

// publicRoutes is the allow-list of routes that work without a session.
// Adding one here is a security decision: say why in the pull request.
var publicRoutes = []string{
	"/",                     // the built web app (no data)
	"/api/",                 // 404 for unknown API paths
	"GET /health",           // status only, for the deploy script and monitoring
	"POST /api/auth/login",  // the login itself
	"POST /api/auth/logout", // always 204, also without a session
}

func testApp(staticDir string) *app {
	a := &app{
		cfg:      &config.Config{StaticDir: staticDir},
		auth:     auth.New(nil),
		planning: planning.New(nil),
		mower:    mower.New(nil, nil),
		ws:       ws.New(context.Background(), nil),
	}
	if staticDir != "" {
		a.static = http.NotFoundHandler()
	}
	return a
}

func TestPublicRoutes(t *testing.T) {
	got := testApp("/static").router().PublicRoutes()
	want := slices.Sorted(slices.Values(publicRoutes))
	if !slices.Equal(got, want) {
		t.Fatalf("public routes changed:\n got %q\nwant %q", got, want)
	}
	// Without STATIC_DIR, the web app is not served at all.
	if slices.Contains(testApp("").router().PublicRoutes(), "/") {
		t.Fatal("/ is served without STATIC_DIR")
	}
}

func TestProtectedRoutes(t *testing.T) {
	got := testApp("").router().ProtectedRoutes()
	want := []string{
		"DELETE /api/maps/{id}",
		"DELETE /api/settings/{key}",
		"GET /api/auth/me",
		"GET /api/devices",
		"GET /api/devices/{name}",
		"GET /api/devices/{name}/events",
		"GET /api/devices/{name}/history",
		"GET /api/maps",
		"GET /api/maps/{id}",
		"GET /api/settings",
		"GET /ws",
		"POST /api/auth/logout-all",
		"POST /api/maps",
		"PUT /api/maps/{id}",
		"PUT /api/settings/{key}",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("protected routes: got %q, want %q", got, want)
	}
}
