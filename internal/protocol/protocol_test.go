package protocol

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func str(s string) *string { return &s }

func testRecord() RecordRow {
	t := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	return RecordRow{ID: 7, Time: t, ConnectionType: ConnMQTT, Value: str("hi"), UpdatedAt: t, CreatedIP: str("203.0.113.7")}
}

func TestRequestJSONShape(t *testing.T) {
	var env RequestEnvelope
	err := Unmarshal([]byte(`{"request_id":"r1","request":{"op":"update","id":3,"value":null}}`), &env)
	if err != nil {
		t.Fatal(err)
	}
	if env.RequestID != "r1" || env.Request.V != (RequestUpdate{ID: 3}) {
		t.Fatalf("got %+v", env)
	}

	var list Request
	if err := json.Unmarshal([]byte(`{"op":"list"}`), &list); err != nil || list.V != (RequestList{}) {
		t.Fatalf("got %+v, %v", list, err)
	}

	out, _ := json.Marshal(Request{V: RequestList{}})
	if string(out) != `{"op":"list"}` {
		t.Fatal(string(out))
	}
	out, _ = json.Marshal(Request{V: RequestCreate{Value: str("x")}})
	if string(out) != `{"op":"create","value":"x"}` {
		t.Fatal(string(out))
	}
}

func TestInvalidRequests(t *testing.T) {
	for _, bad := range []string{
		`{"request_id":"r1","request":{"op":"nope"}}`,
		`{"request_id":"r1","request":{}}`,
		`{"request_id":"r1","request":null}`,
		`{"request_id":"r1"}`,
		`{"request":{"op":"list"}}`,
		`{"request_id":"r1","request":{"op":"update","value":"x"}}`,
		`{"request_id":"r1","request":{"op":"delete","id":null}}`,
		`{"request_id":"r1","request":{"op":"delete","id":"3"}}`,
		`not json`,
	} {
		var env RequestEnvelope
		if err := Unmarshal([]byte(bad), &env); err == nil {
			t.Errorf("accepted %s as %+v", bad, env)
		}
	}
	// A missing "value" is the same as null.
	var env RequestEnvelope
	if err := Unmarshal([]byte(`{"request_id":"r1","request":{"op":"create"}}`), &env); err != nil {
		t.Error(err)
	}
}

func TestServerMessageJSONShape(t *testing.T) {
	msg := ServerMessage{V: MsgEvent{Event: ChangeEvent{V: EventDelete{ID: 7, ConnectionType: ConnHTTPS}}}}
	out, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"type":"event","event":{"op":"delete","id":7,"connection_type":"https"}}`
	if string(out) != want {
		t.Fatalf("got %s", out)
	}

	msg = ServerMessage{V: MsgResponse{Response: ResponseEnvelope{
		RequestID: "r1",
		Result:    RpcResult{V: RpcOk{Data: RpcData{V: RpcRecord{Record: testRecord()}}}},
	}}}
	out, err = json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	var generic map[string]any
	_ = json.Unmarshal(out, &generic)
	result := generic["response"].(map[string]any)["result"].(map[string]any)
	data := result["data"].(map[string]any)
	if result["status"] != "ok" || data["kind"] != "record" {
		t.Fatalf("got %s", out)
	}
	if data["record"].(map[string]any)["time"] != "2026-10-18T12:00:00Z" {
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
	if _, err := json.Marshal(Request{V: "nonsense"}); err == nil {
		t.Fatal("marshalled something that is not a variant")
	}
}

func TestChangeEventRecordID(t *testing.T) {
	r := testRecord()
	for _, e := range []ChangeEvent{
		{V: EventCreate{Record: r}}, {V: EventUpdate{Record: r}}, {V: EventDelete{ID: 7}},
	} {
		if e.RecordID() != 7 {
			t.Errorf("%v", e)
		}
	}
}

func TestValidateValueLength(t *testing.T) {
	if err := (RecordInput{}).Validate(); err != nil {
		t.Error(err)
	}
	if err := (RecordInput{Value: str(strings.Repeat("ž", MaxValueChars))}).Validate(); err != nil {
		t.Error(err)
	}
	if err := (RecordInput{Value: str(strings.Repeat("a", MaxValueChars+1))}).Validate(); err == nil {
		t.Error("too long value accepted")
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

func TestRequestTopicParsing(t *testing.T) {
	if id, ok := ParseRequestTopic("mower", "mower/web-1a/req"); !ok || id != "web-1a" {
		t.Error(id, ok)
	}
	for _, bad := range []string{"mower/a/b/req", "mower//req", "mower/x/res", "mowerx/x/req", "mower/a+b/req", "mower/events/req", "mower/x/req/y", "mower/req"} {
		if id, ok := ParseRequestTopic("mower", bad); ok {
			t.Errorf("%s parsed as %s", bad, id)
		}
	}
	if ResponseTopic("mower", "x") != "mower/x/res" || RequestFilter("mower") != "mower/+/req" {
		t.Error()
	}
	if ValidClientID("a+b") || ValidClientID(strings.Repeat("a", 65)) || ValidClientID("") {
		t.Error()
	}
}
