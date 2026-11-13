package server

import (
	"testing"

	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
)

func TestInvalidRequestKeepsRequestID(t *testing.T) {
	_, failure := ParseRequest([]byte(`{"request_id":"r9","request":{"op":"nope"}}`))
	if failure == nil || failure.RequestID != "r9" {
		t.Fatalf("%+v", failure)
	}
	if e, ok := failure.Result.V.(protocol.RpcError); !ok || e.Error.Code != protocol.CodeBadRequest {
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
	res := respond([]byte(`{"request_id":"p1","request":{"op":"ping"}}`))
	ok, isOk := res.Result.V.(protocol.RpcOk)
	if res.RequestID != "p1" || !isOk || ok.Data.V != (protocol.RpcPong{}) {
		t.Fatalf("%+v", res)
	}
	// The records requests are gone.
	res = respond([]byte(`{"request_id":"l1","request":{"op":"list"}}`))
	if e, isErr := res.Result.V.(protocol.RpcError); !isErr || e.Error.Code != protocol.CodeBadRequest || res.RequestID != "l1" {
		t.Fatalf("%+v", res)
	}
}
