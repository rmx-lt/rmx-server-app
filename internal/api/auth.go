package api

import (
	"fmt"
	"log/slog"
)

// LoginRequest is the body of POST /app/api/auth/login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// String and LogValue keep the password out of log lines.
func (r LoginRequest) String() string { return fmt.Sprintf("LoginRequest{Username: %q}", r.Username) }

// GoString is what %#v prints.
func (r LoginRequest) GoString() string { return r.String() }

// LogValue is what slog prints.
func (r LoginRequest) LogValue() slog.Value {
	return slog.GroupValue(slog.String("username", r.Username))
}

// Me is the logged-in user: the answer to a login and to GET /app/api/auth/me.
type Me struct {
	Username string `json:"username"`
}
