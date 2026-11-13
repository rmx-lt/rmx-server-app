// Package apperr is the error type the domains return. Each transport turns
// it into its own format: an HTTP status plus a JSON body (httpx.WriteError),
// or an RpcError. It imports api for the error codes.
package apperr

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/rmx-lt/rmx-server-app/internal/api"
)

// Error is an error with a code the client understands.
type Error struct {
	Code api.ErrorCode
	// Message is shown to the client.
	Message string
	// RetryAfter is the seconds to wait, for CodeTooManyRequests.
	RetryAfter int
	// Err is the cause, for the server log only.
	Err error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.Err }

// BadRequest is an input the client has to fix.
func BadRequest(format string, args ...any) *Error {
	return &Error{Code: api.CodeBadRequest, Message: fmt.Sprintf(format, args...)}
}

// DB is a database failure. The details stay in the server log, not in the response.
func DB(err error) *Error {
	return &Error{Code: api.CodeInternal, Message: "database error", Err: err}
}

// Internal is any other unexpected failure.
func Internal(err error) *Error {
	return &Error{Code: api.CodeInternal, Message: "internal error", Err: err}
}

// Unauthorized: no valid session.
func Unauthorized() *Error {
	return &Error{Code: api.CodeUnauthorized, Message: "login required"}
}

// InvalidCredentials is the same answer for a wrong password and an unknown user.
func InvalidCredentials() *Error {
	return &Error{Code: api.CodeUnauthorized, Message: "wrong username or password"}
}

// Forbidden: the request came from a page on another origin.
func Forbidden(message string) *Error {
	return &Error{Code: api.CodeForbidden, Message: message}
}

// TooManyRequests: wait retryAfter seconds.
func TooManyRequests(retryAfter int) *Error {
	return &Error{
		Code:       api.CodeTooManyRequests,
		Message:    fmt.Sprintf("too many failed logins, try again in %d s", retryAfter),
		RetryAfter: retryAfter,
	}
}

// From turns any error into an *Error: other errors are internal ones.
func From(err error) *Error {
	if e, ok := err.(*Error); ok {
		return e
	}
	return Internal(err)
}

// API is the body the client sees.
func (e *Error) API() api.ApiError {
	return api.ApiError{Code: e.Code, Message: e.Message}
}

// Status is the HTTP status for REST.
func (e *Error) Status() int {
	switch e.Code {
	case api.CodeBadRequest:
		return http.StatusBadRequest
	case api.CodeNotFound:
		return http.StatusNotFound
	case api.CodeUnauthorized:
		return http.StatusUnauthorized
	case api.CodeForbidden:
		return http.StatusForbidden
	case api.CodeTooManyRequests:
		return http.StatusTooManyRequests
	default:
		return http.StatusInternalServerError
	}
}

// Log writes the cause of a server-side failure to the log.
func (e *Error) Log() {
	if e.Code == api.CodeInternal {
		slog.Error(e.Message, "error", e.Err)
	}
}
