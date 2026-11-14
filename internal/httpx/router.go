// Package httpx is the HTTP plumbing the domains share: a Router whose only
// two ways to add a route are Public() and Protected(), and the JSON helpers.
package httpx

import (
	"net/http"
	"slices"
)

// Router is an http.ServeMux that fails closed: a route is either in the
// Public group (works without a session) or in the Protected group (every
// request passes the session middleware first). There is no third way to
// register, so a new route cannot be public by accident, and the app's test
// compares PublicRoutes with an allow-list.
type Router struct {
	mux       *http.ServeMux
	public    *Group
	protected *Group
}

// Group registers routes on its Router with one middleware (or none).
type Group struct {
	mux      *http.ServeMux
	wrap     func(http.Handler) http.Handler
	patterns []string
}

// NewRouter returns a router whose Protected group runs every request
// through requireSession. requireSession must not be nil.
func NewRouter(requireSession func(http.Handler) http.Handler) *Router {
	if requireSession == nil {
		panic("httpx: NewRouter without a session middleware")
	}
	mux := http.NewServeMux()
	return &Router{
		mux:       mux,
		public:    &Group{mux: mux, wrap: func(h http.Handler) http.Handler { return h }},
		protected: &Group{mux: mux, wrap: requireSession},
	}
}

// Public is the group of routes that work without a session.
func (r *Router) Public() *Group { return r.public }

// Protected is the group of routes that need a valid session.
func (r *Router) Protected() *Group { return r.protected }

// PublicRoutes lists the patterns registered with Public, sorted.
func (r *Router) PublicRoutes() []string { return sorted(r.public.patterns) }

// ProtectedRoutes lists the patterns registered with Protected, sorted.
func (r *Router) ProtectedRoutes() []string { return sorted(r.protected.patterns) }

func sorted(s []string) []string {
	out := slices.Clone(s)
	slices.Sort(out)
	return out
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) { r.mux.ServeHTTP(w, req) }

// Handle registers h for pattern (http.ServeMux syntax).
func (g *Group) Handle(pattern string, h http.Handler) {
	g.mux.Handle(pattern, g.wrap(h))
	g.patterns = append(g.patterns, pattern)
}

// HandleFunc registers f for pattern (http.ServeMux syntax).
func (g *Group) HandleFunc(pattern string, f http.HandlerFunc) { g.Handle(pattern, f) }
