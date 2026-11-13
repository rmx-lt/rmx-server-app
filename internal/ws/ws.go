// Package ws is the WebSocket transport at /app/ws: the connections
// (keep-alive, session re-check, close codes, shutdown), the routing of each
// request op to its handler, and the push of server events to every open
// socket. It is the only package that imports coder/websocket.
//
// Client to server: RequestEnvelope JSON text frames.
// Server to client: ServerMessage JSON, the response to each request, and
// pushed events.
//
// Domains register their ops with Handle; ping is built in.
package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/events"
)

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

// SessionCheck reports whether the session of user is still valid. A socket
// stays open for hours, so it is asked again with every keep-alive ping.
type SessionCheck func(ctx context.Context, user core.CurrentUser) bool

type handler func(ctx context.Context, user core.CurrentUser, req any) (any, error)

// Server serves the WebSocket connections.
type Server struct {
	// ctx ends when the server is asked to stop; sockets close then.
	ctx          context.Context
	sessionValid SessionCheck
	handlers     map[reflect.Type]handler
	push         *events.Bus[api.ServerMessage]
	// sockets counts the open WebSockets: they are hijacked, so
	// http.Server.Shutdown does not wait for them.
	sockets sync.WaitGroup
}

// New returns a Server whose sockets close when ctx ends. sessionValid is
// asked on every keep-alive ping.
func New(ctx context.Context, sessionValid SessionCheck) *Server {
	s := &Server{ctx: ctx, sessionValid: sessionValid, handlers: map[reflect.Type]handler{}, push: events.New[api.ServerMessage]()}
	Handle(s, func(context.Context, core.CurrentUser, api.RequestPing) (any, error) { return api.RpcPong{}, nil })
	return s
}

// Handle routes requests whose variant is T to fn. fn returns a variant of
// api.RpcData, or an error (an *apperr.Error keeps its code). Call it before
// serving.
func Handle[T any](s *Server, fn func(ctx context.Context, user core.CurrentUser, req T) (any, error)) {
	s.handlers[reflect.TypeFor[T]()] = func(ctx context.Context, user core.CurrentUser, req any) (any, error) {
		return fn(ctx, user, req.(T))
	}
}

// Push sends msg to every open socket. It never blocks; a socket too slow to
// keep up is closed (the client reconnects and loads again).
func (s *Server) Push(msg api.ServerMessage) { s.push.Publish(msg) }

// Wait returns when every socket has closed.
func (s *Server) Wait() { s.sockets.Wait() }

// ServeHTTP upgrades the request. It must only be reached with a valid
// session (the router's Protected group) and after the Origin check.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user, _ := core.UserFrom(r.Context())
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

func (s *Server) serveSocket(conn *websocket.Conn, user core.CurrentUser) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer conn.CloseNow()

	slog.Debug("websocket connected", "username", user.Username)
	defer slog.Debug("websocket disconnected")

	pushed := s.push.Subscribe()
	defer pushed.Close()

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

	send := func(msg api.ServerMessage) bool {
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
			response := s.respond(ctx, user, text)
			if !send(api.ServerMessage{V: api.MsgResponse{Response: response}}) {
				return
			}

		case msg, ok := <-pushed.C:
			if !ok {
				closeWithin(conn, cancel, websocket.StatusTryAgainLater, "too slow, reconnect")
				return
			}
			if !send(msg) {
				return
			}

		case <-ping.C:
			if !s.sessionValid(ctx, user) {
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
func (s *Server) respond(ctx context.Context, user core.CurrentUser, text []byte) api.ResponseEnvelope {
	env, failure := ParseRequest(text)
	if failure != nil {
		return *failure
	}
	var result api.RpcResult
	h, ok := s.handlers[reflect.TypeOf(env.Request.V)]
	if !ok { // a variant added to the union but not handled
		result.V = api.RpcError{Error: api.ApiError{Code: api.CodeInternal, Message: "request not supported"}}
		return api.ResponseEnvelope{RequestID: env.RequestID, Result: result}
	}
	data, err := h(ctx, user, env.Request.V)
	if err != nil {
		e := apperr.From(err)
		e.Log()
		result.V = api.RpcError{Error: e.API()}
	} else {
		result.V = api.RpcOk{Data: api.RpcData{V: data}}
	}
	return api.ResponseEnvelope{RequestID: env.RequestID, Result: result}
}

// ParseRequest parses a RequestEnvelope. On failure it returns the error
// response to send, keeping the request_id if the message had one.
func ParseRequest(payload []byte) (api.RequestEnvelope, *api.ResponseEnvelope) {
	var env api.RequestEnvelope
	err := api.Unmarshal(payload, &env)
	if err == nil {
		return env, nil
	}
	var partial struct {
		RequestID string `json:"request_id"`
	}
	_ = json.Unmarshal(payload, &partial)
	return env, &api.ResponseEnvelope{
		RequestID: partial.RequestID,
		Result: api.RpcResult{V: api.RpcError{Error: api.ApiError{
			Code:    api.CodeBadRequest,
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
