package app

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/auth"
	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/ws"
)

// publicRoutes is the allow-list of routes that work without a session.
// Adding one here is a security decision: say why in the pull request.
var publicRoutes = []string{
	"/app/",                     // the built web app (no data)
	"/app/api/",                 // 404 for unknown API paths
	"GET /app",                  // redirect to /app/
	"GET /app/health",           // status only, for the deploy script and monitoring
	"POST /app/api/auth/login",  // the login itself
	"POST /app/api/auth/logout", // always 204, also without a session
}

func testApp(staticDir string) *app {
	a := &app{
		cfg:  &config.Config{StaticDir: staticDir},
		auth: auth.New(nil),
		ws:   ws.New(context.Background(), nil),
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
	if slices.Contains(testApp("").router().PublicRoutes(), "/app/") {
		t.Fatal("/app/ is served without STATIC_DIR")
	}
}

func TestProtectedRoutes(t *testing.T) {
	got := testApp("").router().ProtectedRoutes()
	want := []string{"GET /app/api/auth/me", "GET /app/ws", "POST /app/api/auth/logout-all"}
	if !slices.Equal(got, want) {
		t.Fatalf("protected routes: got %q, want %q", got, want)
	}
}
