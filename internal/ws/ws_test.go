package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

func TestInvalidRequestKeepsRequestID(t *testing.T) {
	_, failure := ParseRequest([]byte(`{"request_id":"r9","request":{"op":"nope"}}`))
	if failure == nil || failure.RequestID != "r9" {
		t.Fatalf("%+v", failure)
	}
	if e, ok := failure.Result.V.(api.RpcError); !ok || e.Error.Code != api.CodeBadRequest {
		t.Fatalf("%+v", failure.Result)
	}

	_, failure = ParseRequest([]byte("not json"))
	if failure == nil || failure.RequestID != "" {
		t.Fatalf("%+v", failure)
	}

	env, failure := ParseRequest([]byte(`{"request_id":"r1","request":{"op":"ping"}}`))
	if failure != nil || env.RequestID != "r1" {
		t.Fatalf("%+v %+v", env, failure)
	}
}

func TestPingIsAnsweredWithPong(t *testing.T) {
	s := New(context.Background(), nil)
	ctx := context.Background()
	res, answered := s.respond(ctx, core.CurrentUser{}, []byte(`{"request_id":"p1","request":{"op":"ping"}}`))
	ok, isOk := res.Result.V.(api.RpcOk)
	if !answered || res.RequestID != "p1" || !isOk || ok.Data.V != (api.RpcPong{}) {
		t.Fatalf("%+v", res)
	}
	// The records requests are gone.
	res, _ = s.respond(ctx, core.CurrentUser{}, []byte(`{"request_id":"l1","request":{"op":"list"}}`))
	if e, isErr := res.Result.V.(api.RpcError); !isErr || e.Error.Code != api.CodeBadRequest || res.RequestID != "l1" {
		t.Fatalf("%+v", res)
	}
}

// A handler that returns NoResponse sends no answer, but an error is still answered.
func TestNoResponseHandler(t *testing.T) {
	s := New(context.Background(), nil)
	var fail bool
	Handle(s, func(context.Context, core.CurrentUser, api.RequestDrive) (any, error) {
		if fail {
			return NoResponse, errors.New("nope")
		}
		return NoResponse, nil
	})
	body := []byte(`{"request_id":"d1","request":{"op":"drive","device":"m1","v":0.5,"w":0}}`)
	if _, answered := s.respond(context.Background(), core.CurrentUser{}, body); answered {
		t.Fatal("a setpoint was answered")
	}
	fail = true
	res, answered := s.respond(context.Background(), core.CurrentUser{}, body)
	if _, isErr := res.Result.V.(api.RpcError); !answered || !isErr || res.RequestID != "d1" {
		t.Fatalf("a failing setpoint is answered with an error: %+v", res)
	}
}

func TestSocketAnswersAndReceivesPushes(t *testing.T) {
	ctx, stop := context.WithCancel(context.Background())
	s := New(ctx, func(context.Context, core.CurrentUser) bool { return true })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.ServeHTTP(w, r.WithContext(core.WithUser(r.Context(), core.CurrentUser{Username: "a"})))
	}))
	defer srv.Close()

	dctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(dctx, strings.Replace(srv.URL, "http", "ws", 1), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	read := func() api.ServerMessage {
		t.Helper()
		_, data, err := c.Read(dctx)
		if err != nil {
			t.Fatal(err)
		}
		var m api.ServerMessage
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		return m
	}

	// The answer to a request shows the socket is subscribed to pushes.
	if err := c.Write(dctx, websocket.MessageText, []byte(`{"request_id":"p1","request":{"op":"ping"}}`)); err != nil {
		t.Fatal(err)
	}
	if m := read().V.(api.MsgResponse); m.Response.RequestID != "p1" {
		t.Fatalf("%+v", m)
	}
	s.Push(api.ServerMessage{V: api.MsgResponse{Response: api.ResponseEnvelope{
		RequestID: "pushed", Result: api.RpcResult{V: api.RpcOk{Data: api.RpcData{V: api.RpcPong{}}}},
	}}})
	if m := read().V.(api.MsgResponse); m.Response.RequestID != "pushed" {
		t.Fatalf("%+v", m)
	}

	// Shutdown closes the socket with "going away", and Wait returns.
	stop()
	if _, _, err := c.Read(dctx); websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("closed with %v", err)
	}
	s.Wait()
}
