package protocol

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

func TestRequestJSONShape(t *testing.T) {
	var env RequestEnvelope
	if err := Unmarshal([]byte(`{"request_id":"r1","request":{"op":"ping"}}`), &env); err != nil {
		t.Fatal(err)
	}
	if env.RequestID != "r1" || env.Request.V != (RequestPing{}) {
		t.Fatalf("got %+v", env)
	}
	out, _ := json.Marshal(Request{V: RequestPing{}})
	if string(out) != `{"op":"ping"}` {
		t.Fatal(string(out))
	}
}

func TestInvalidRequests(t *testing.T) {
	for _, bad := range []string{
		`{"request_id":"r1","request":{"op":"nope"}}`,
		`{"request_id":"r1","request":{"op":"list"}}`,
		`{"request_id":"r1","request":{}}`,
		`{"request_id":"r1","request":{"op":3}}`,
		`{"request_id":"r1","request":null}`,
		`{"request_id":"r1"}`,
		`{"request":{"op":"ping"}}`,
		`not json`,
	} {
		var env RequestEnvelope
		if err := Unmarshal([]byte(bad), &env); err == nil {
			t.Errorf("accepted %s as %+v", bad, env)
		}
	}
}

func TestServerMessageJSONShape(t *testing.T) {
	msg := ServerMessage{V: MsgResponse{Response: ResponseEnvelope{
		RequestID: "r1",
		Result:    RpcResult{V: RpcOk{Data: RpcData{V: RpcPong{}}}},
	}}}
	out, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"type":"response","response":{"request_id":"r1","result":{"status":"ok","data":{"kind":"pong"}}}}`
	if string(out) != want {
		t.Fatalf("got %s", out)
	}
	var back ServerMessage
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatal(err)
	}
	again, _ := json.Marshal(back)
	if string(again) != string(out) {
		t.Fatalf("round trip: %s != %s", again, out)
	}

	out, _ = json.Marshal(RpcResult{V: RpcError{Error: ApiError{Code: CodeBadRequest, Message: "no"}}})
	if string(out) != `{"status":"error","error":{"code":"bad_request","message":"no"}}` {
		t.Fatalf("got %s", out)
	}
	if _, err := json.Marshal(Request{V: "nonsense"}); err == nil {
		t.Fatal("marshalled something that is not a variant")
	}
}

func TestLoginRequestHidesPassword(t *testing.T) {
	req := LoginRequest{Username: "probe", Password: "hunter2"}
	for _, s := range []string{
		fmt.Sprintf("%v", req), fmt.Sprintf("%+v", req), fmt.Sprintf("%#v", req), fmt.Sprint(&req),
		slog.GroupValue(slog.Any("req", req)).String(),
	} {
		if !strings.Contains(s, "probe") || strings.Contains(s, "hunter2") {
			t.Errorf("%s", s)
		}
	}
	out, _ := json.Marshal(ErrorCode("too_many_requests"))
	if string(out) != `"too_many_requests"` {
		t.Error(string(out))
	}
}

func TestFirmwareTopicParsing(t *testing.T) {
	if id, ok := ParseFirmwareRequestTopic("mower", "mower/mower-01/fw/req"); !ok || id != "mower-01" {
		t.Fatal(id, ok)
	}
	if FirmwareRequestFilter("mower") != "mower/+/fw/req" ||
		FirmwareChunkTopic("mower", "mower-01") != "mower/mower-01/fw/chunk" ||
		FirmwareResponseTopic("mower", "mower-01") != "mower/mower-01/fw/res" {
		t.Fatal("topic shape")
	}
	for _, bad := range []string{
		"mower/mower-01/req",
		"mower/mower-01/fw/req/x",
		"mower/mower-01/fw/chunk",
		"mower/mower-01/fw/res",
		"mower/a/b/fw/req",
		"mower//fw/req",
		"mower/status/fw/req",
		"mower/" + strings.Repeat("a", 65) + "/fw/req",
		"mower/a+b/fw/req",
		"mowerx/a/fw/req",
		"other/a/fw/req",
	} {
		if id, ok := ParseFirmwareRequestTopic("mower", bad); ok {
			t.Errorf("%s parsed as %s", bad, id)
		}
	}
}
