// Package protocol defines the wire types shared by rmx-server and the
// browser client.
//
// Everything here is plain JSON over the wire: REST bodies and the request
// and response envelopes of the WebSocket. The TypeScript copies in
// client/src/generated are generated from these types by cmd/gen-ts
// (run `go run ./cmd/gen-ts`).
//
// Types that are a union in TypeScript (Request, RpcResult, ...) are structs
// holding one variant in V; see union.go.
package protocol

import (
	"fmt"
	"log/slog"
)

// ErrorCode says what went wrong, in an ApiError.
type ErrorCode string

const (
	CodeBadRequest ErrorCode = "bad_request"
	CodeNotFound   ErrorCode = "not_found"
	CodeInternal   ErrorCode = "internal"
	// CodeUnauthorized: no valid session (REST: 401), or wrong username or password at login.
	CodeUnauthorized ErrorCode = "unauthorized"
	// CodeForbidden: the request came from a page on another origin (REST: 403).
	CodeForbidden ErrorCode = "forbidden"
	// CodeTooManyRequests: too many failed logins; wait Retry-After seconds (REST: 429).
	CodeTooManyRequests ErrorCode = "too_many_requests"
)

// ---- Requests (client to server, over the WebSocket) ------------------------

// RequestPing asks the server to answer with an RpcPong. It is the only
// request today: a client can use it to check that the connection works.
type RequestPing struct{}

// Request is an operation, sent by the client over the WebSocket.
type Request struct {
	// V is a RequestPing.
	V any
}

// RequestEnvelope is a request plus the id the client uses to match the response.
type RequestEnvelope struct {
	RequestID string  `json:"request_id"`
	Request   Request `json:"request"`
}

// ---- Responses --------------------------------------------------------------

// ApiError is the error body, used by REST (with a matching HTTP status) and
// in RpcError.
type ApiError struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
}

// RpcPong answers a ping.
type RpcPong struct{}

// RpcData is the payload of a successful answer.
type RpcData struct {
	// V is an RpcPong.
	V any
}

// RpcOk is a successful result.
type RpcOk struct {
	Data RpcData `json:"data"`
}

// RpcError is a failed result.
type RpcError struct {
	Error ApiError `json:"error"`
}

// RpcResult is the outcome of one request.
type RpcResult struct {
	// V is an RpcOk or RpcError.
	V any
}

// ResponseEnvelope is the answer to one RequestEnvelope.
type ResponseEnvelope struct {
	// Copied from the request. Empty if the request could not be parsed at all.
	RequestID string    `json:"request_id"`
	Result    RpcResult `json:"result"`
}

// MsgResponse is the answer to a request.
type MsgResponse struct {
	Response ResponseEnvelope `json:"response"`
}

// ServerMessage is every message the server sends on the WebSocket.
type ServerMessage struct {
	// V is a MsgResponse.
	V any
}

// ---- Plain REST bodies ------------------------------------------------------

// Health is the body of GET /app/health.
type Health struct {
	// "ok" when the database and the MQTT broker are both reachable, else "degraded".
	Status  string `json:"status"`
	DB      bool   `json:"db"`
	MQTT    bool   `json:"mqtt"`
	Version string `json:"version"`
}

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
