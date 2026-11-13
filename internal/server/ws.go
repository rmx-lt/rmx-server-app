package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/rmx-lt/rmx-backend-probe/internal/auth"
	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
)

// WebSocket transport at /probe/ws.
//
// Client to server: RequestEnvelope JSON text frames.
// Server to client: ServerMessage JSON, the response to each request.
//
// The only request today is a ping; the connection itself (session check,
// keep-alive, close codes) is what the next features build on.

const (
	// pingInterval keeps idle connections alive through proxies and detects dead peers.
	pingInterval = 30 * time.Second
	// maxMessageSize is the largest frame accepted from a client.
	maxMessageSize = 64 * 1024
	writeTimeout   = 10 * time.Second
	// closeTimeout is how long to wait for a client to answer our close frame.
	closeTimeout = 2 * time.Second

	// StatusSessionEnded is the close code sent when the session behind the
	// socket has ended (logout, timeout, password change). The client then
	// shows the login form.
	StatusSessionEnded websocket.StatusCode = 4001
)

// handleWS is only reached with a valid session: RequireSession runs before
// this, and the Origin check before that.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	user, _ := auth.UserFrom(r.Context())
	s.sockets.Add(1)
	defer s.sockets.Done()
	// The library's own Origin check compares with the Host header, which is
	// wrong behind a proxy; ours (auth.CheckOrigin) has already run.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return // Accept has answered the client
	}
	conn.SetReadLimit(maxMessageSize)
	s.serveSocket(conn, user)
}

func (s *Server) serveSocket(conn *websocket.Conn, user auth.CurrentUser) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer conn.CloseNow()

	slog.Debug("websocket connected", "username", user.Username)
	defer slog.Debug("websocket disconnected")

	// A reader goroutine, so pings can be answered and a close noticed while a request runs.
	texts := make(chan []byte)
	readFailed := make(chan error, 1)
	go func() {
		for {
			kind, data, err := conn.Read(ctx)
			if err != nil {
				readFailed <- err
				return
			}
			if kind != websocket.MessageText {
				continue // binary frames are ignored
			}
			select {
			case texts <- data:
			case <-ctx.Done():
				return
			}
		}
	}()

	send := func(msg protocol.ServerMessage) bool {
		body, err := json.Marshal(msg)
		if err != nil {
			slog.Error("encoding a websocket message failed", "error", err)
			return false
		}
		wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
		defer wcancel()
		return conn.Write(wctx, websocket.MessageText, body) == nil
	}

	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		select {
		case text := <-texts:
			response := respond(text)
			if !send(protocol.ServerMessage{V: protocol.MsgResponse{Response: response}}) {
				return
			}

		case <-ping.C:
			// A socket stays open for hours, so the session is checked again
			// with every ping: logging out (anywhere) or a timeout closes it
			// within pingInterval.
			if u, err := s.auth.Validate(ctx, user.SessionHash, false); err != nil || u == nil {
				closeWithin(conn, cancel, StatusSessionEnded, "session ended")
				return
			}
			pctx, pcancel := context.WithTimeout(ctx, 10*time.Second)
			err := conn.Ping(pctx)
			pcancel()
			if err != nil {
				return
			}

		case err := <-readFailed:
			slog.Debug("websocket read ended", "error", err)
			return

		case <-s.ctx.Done():
			closeWithin(conn, cancel, websocket.StatusGoingAway, "server shutting down")
			return
		}
	}
}

// respond answers one request.
func respond(text []byte) protocol.ResponseEnvelope {
	env, failure := ParseRequest(text)
	if failure != nil {
		return *failure
	}
	var result protocol.RpcResult
	switch env.Request.V.(type) {
	case protocol.RequestPing:
		result.V = protocol.RpcOk{Data: protocol.RpcData{V: protocol.RpcPong{}}}
	default: // a variant added to the union but not handled here
		result.V = protocol.RpcError{Error: protocol.ApiError{Code: protocol.CodeInternal, Message: "request not supported"}}
	}
	return protocol.ResponseEnvelope{RequestID: env.RequestID, Result: result}
}

// ParseRequest parses a RequestEnvelope. On failure it returns the error
// response to send, keeping the request_id if the message had one.
func ParseRequest(payload []byte) (protocol.RequestEnvelope, *protocol.ResponseEnvelope) {
	var env protocol.RequestEnvelope
	err := protocol.Unmarshal(payload, &env)
	if err == nil {
		return env, nil
	}
	var partial struct {
		RequestID string `json:"request_id"`
	}
	_ = json.Unmarshal(payload, &partial)
	return env, &protocol.ResponseEnvelope{
		RequestID: partial.RequestID,
		Result: protocol.RpcResult{V: protocol.RpcError{Error: protocol.ApiError{
			Code:    protocol.CodeBadRequest,
			Message: fmt.Sprintf("invalid request: %v", err),
		}}},
	}
}

// closeWithin sends a close frame and waits for the client's answer, but not
// longer than closeTimeout: a client that has stopped reading must not hold up
// a shutdown. Then cancel (the context of the reader goroutine) drops the connection.
func closeWithin(conn *websocket.Conn, cancel context.CancelFunc, code websocket.StatusCode, reason string) {
	done := make(chan struct{})
	go func() {
		_ = conn.Close(code, reason)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(closeTimeout):
		cancel()
		<-done
	}
}
