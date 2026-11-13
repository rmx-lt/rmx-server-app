package api

// The WebSocket (/app/ws): request and response envelopes.

// ---- Requests (client to server) --------------------------------------------

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
