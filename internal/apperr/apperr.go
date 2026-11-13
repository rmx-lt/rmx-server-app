// Package apperr is the error type of the login code. Each
// transport turns it into its own format: an HTTP status plus a JSON body, or
// an RpcError.
package apperr

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
)

// Error is an error with a code the client understands.
type Error struct {
	Code protocol.ErrorCode
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
	return &Error{Code: protocol.CodeBadRequest, Message: fmt.Sprintf(format, args...)}
}

// DB is a database failure. The details stay in the server log, not in the response.
func DB(err error) *Error {
	return &Error{Code: protocol.CodeInternal, Message: "database error", Err: err}
}

// Internal is any other unexpected failure.
func Internal(err error) *Error {
	return &Error{Code: protocol.CodeInternal, Message: "internal error", Err: err}
}

// Unauthorized: no valid session.
func Unauthorized() *Error {
	return &Error{Code: protocol.CodeUnauthorized, Message: "login required"}
}

// InvalidCredentials is the same answer for a wrong password and an unknown user.
func InvalidCredentials() *Error {
	return &Error{Code: protocol.CodeUnauthorized, Message: "wrong username or password"}
}

// Forbidden: the request came from a page on another origin.
func Forbidden(message string) *Error {
	return &Error{Code: protocol.CodeForbidden, Message: message}
}

// TooManyRequests: wait retryAfter seconds.
func TooManyRequests(retryAfter int) *Error {
	return &Error{
		Code:       protocol.CodeTooManyRequests,
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
func (e *Error) API() protocol.ApiError {
	return protocol.ApiError{Code: e.Code, Message: e.Message}
}

// Status is the HTTP status for REST.
func (e *Error) Status() int {
	switch e.Code {
	case protocol.CodeBadRequest:
		return http.StatusBadRequest
	case protocol.CodeNotFound:
		return http.StatusNotFound
	case protocol.CodeUnauthorized:
		return http.StatusUnauthorized
	case protocol.CodeForbidden:
		return http.StatusForbidden
	case protocol.CodeTooManyRequests:
		return http.StatusTooManyRequests
	default:
		return http.StatusInternalServerError
	}
}

// Log writes the cause of a server-side failure to the log.
func (e *Error) Log() {
	if e.Code == protocol.CodeInternal {
		slog.Error(e.Message, "error", e.Err)
	}
}

// WriteJSON writes v as a JSON response.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.Error("encoding a response failed", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(append(body, '\n'))
}

// Write logs the error if it is a server failure and sends it as the response.
func Write(w http.ResponseWriter, err error) {
	e := From(err)
	e.Log()
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(e.RetryAfter))
	}
	WriteJSON(w, e.Status(), e.API())
}

// maxBody is the largest request body read; the biggest legitimate one (a
// login) is far smaller.
const maxBody = 64 << 10

// ReadJSON reads the request body into v (a struct pointer, see
// protocol.Unmarshal for what counts as a missing member).
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) *Error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		return BadRequest("request body could not be read (at most %d KiB)", maxBody>>10)
	}
	if err := protocol.Unmarshal(body, v); err != nil {
		return BadRequest("invalid request body: %v", err)
	}
	return nil
}
