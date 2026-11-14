// Package api is the browser contract: the REST bodies, the WebSocket
// envelopes and their unions, and the error codes, one file per domain.
//
// Everything here is plain JSON over the wire. The TypeScript copies in
// web/src/data/api/generated are generated from these types by cmd/gen-ts
// (run `go run ./cmd/gen-ts`), which reads only this package. Device
// payloads (MQTT) are not here: they belong to their domain's mqtt.go.
//
// Types that are a union in TypeScript (Request, RpcResult, ...) are structs
// holding one variant in V; see union.go.
package api

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

// ApiError is the error body, used by REST (with a matching HTTP status) and
// in RpcError.
type ApiError struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
}
