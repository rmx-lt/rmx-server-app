package httpx

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/apperr"
)

func TestProtectedRoutesGoThroughTheMiddleware(t *testing.T) {
	deny := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) })
	}
	ok := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }
	r := NewRouter(deny)
	r.Public().HandleFunc("GET /open", ok)
	r.Protected().HandleFunc("GET /closed", ok)

	for path, want := range map[string]int{"/open": 200, "/closed": 401} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != want {
			t.Errorf("%s: %d, want %d", path, rec.Code, want)
		}
	}
	if !slices.Equal(r.PublicRoutes(), []string{"GET /open"}) || !slices.Equal(r.ProtectedRoutes(), []string{"GET /closed"}) {
		t.Fatal(r.PublicRoutes(), r.ProtectedRoutes())
	}
}

func TestNewRouterNeedsAMiddleware(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("no panic")
		}
	}()
	NewRouter(nil)
}

func TestWriteErrorSetsRetryAfter(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteError(rec, apperr.TooManyRequests(4))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "4" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
}
