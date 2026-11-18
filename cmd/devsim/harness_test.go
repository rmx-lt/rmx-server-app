package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// A test rig plays the server over the same topics the broker carries: it
// feeds mower.inbound with what the server would publish, and reads what the
// mower sinks. The clock is fake, so a minute of mower time costs milliseconds.

var epoch = time.Unix(1_800_000_000, 0)

const (
	testPrefix = "mower"
	testName   = "mower-t"
	tick       = 20 * time.Millisecond
)

type rig struct {
	t     *testing.T
	now   time.Time
	m     *mower
	out   []outMsg
	read  map[string]int // per topic: how many of its messages were taken
	files map[string][]byte
	// drop[set]: answers to chunk requests on that set (path, gw-fw, ap-fw) that
	// are not sent; served counts every request.
	drop   map[string]int
	served map[string]int
	reqIDs map[string][]string
}

func newRig(t *testing.T, mutate ...func(*simConfig)) *rig {
	t.Helper()
	r := &rig{t: t, now: epoch, read: map[string]int{}, files: map[string][]byte{}, drop: map[string]int{},
		served: map[string]int{}, reqIDs: map[string][]string{}}
	cfg := simConfig{prefix: testPrefix, name: testName, clock: func() time.Time { return r.now }}
	for _, f := range mutate {
		f(&cfg)
	}
	r.m = newMower(cfg, func(topic string, qos byte, retain bool, payload []byte) {
		r.out = append(r.out, outMsg{topic, qos, retain, append([]byte(nil), payload...)})
	})
	return r
}

// online connects the gateway, says the server is online and lets the link come up.
func (r *rig) online() *rig {
	r.m.setMQTT(true)
	r.serverStatus("online")
	r.advance(2 * time.Second)
	return r
}

func (r *rig) serverStatus(s string) {
	r.m.inbound(testPrefix+"/status/server", []byte(s))
}

// advance moves the clock in 20 ms steps and answers chunk requests as the
// server would.
func (r *rig) advance(d time.Duration) {
	r.t.Helper()
	end := r.now.Add(d)
	for r.now.Before(end) {
		r.now = r.now.Add(tick)
		r.m.step()
		r.serve()
	}
}

func (r *rig) topic(rel string) string { return testPrefix + "/" + testName + "/" + rel }

// toMower publishes a message to the mower on a device topic.
func (r *rig) toMower(rel string, payload []byte) {
	r.m.inbound(r.topic(rel), payload)
	r.serve()
}

func (r *rig) cmd(board, id, cmd string, params ...string) {
	r.t.Helper()
	body := fmt.Sprintf(`{"id":%q,"cmd":%q`, id, cmd)
	for _, p := range params {
		body += "," + p
	}
	r.toMower(board+"/cmd", []byte(body+"}"))
}

// msgs returns the messages on a topic that were not taken yet.
func (r *rig) msgs(rel string) []outMsg {
	var all []outMsg
	for _, m := range r.out {
		if m.topic == rel {
			all = append(all, m)
		}
	}
	return all
}

func (r *rig) take(rel string) []outMsg {
	all := r.msgs(rel)
	n := r.read[rel]
	r.read[rel] = len(all)
	return all[n:]
}

func (r *rig) takeJSON(rel string) []map[string]any {
	var out []map[string]any
	for _, m := range r.take(rel) {
		var v map[string]any
		if err := json.Unmarshal(m.payload, &v); err != nil {
			r.t.Fatalf("%s: not JSON: %v: %s", rel, err, m.payload)
		}
		out = append(out, v)
	}
	return out
}

// acks returns every ack ever published for an id on a board's cmd/ack.
func (r *rig) acks(board, id string) []map[string]any {
	var out []map[string]any
	for _, m := range r.msgs(board + "/cmd/ack") {
		var a map[string]any
		if json.Unmarshal(m.payload, &a) == nil && a["id"] == id {
			out = append(out, a)
		}
	}
	return out
}

// ack is the newest ack for an id.
func (r *rig) ack(board, id string) map[string]any {
	r.t.Helper()
	as := r.acks(board, id)
	if len(as) == 0 {
		r.t.Fatalf("no ack for %s on %s", id, board)
	}
	return as[len(as)-1]
}

// events returns the autopilot events not taken yet.
func (r *rig) events() []map[string]any { return r.takeJSON("autopilot/event") }

func eventNames(evs []map[string]any) []string {
	var n []string
	for _, e := range evs {
		n = append(n, e["event"].(string))
	}
	return n
}

func (r *rig) wantAck(board, id, state, errCode string) map[string]any {
	r.t.Helper()
	a := r.ack(board, id)
	if a["state"] != state || (errCode != "" && a["error"] != errCode) {
		r.t.Fatalf("ack %s: want state %s error %q, got %v", id, state, errCode, a)
	}
	return a
}

// ---- the server's chunk service ---------------------------------------------------

// setOf maps a request topic to a name of a set of files.
var reqTopics = map[string]string{"autopilot/path/req": "path", "gateway/fw/req": "gw-fw", "autopilot/fw/req": "ap-fw"}
var chunkTopics = map[string]string{"path": "autopilot/path/chunk", "gw-fw": "gateway/fw/chunk", "ap-fw": "autopilot/fw/chunk"}
var resTopics = map[string]string{"path": "autopilot/path/res", "gw-fw": "gateway/fw/res", "ap-fw": "autopilot/fw/res"}

func (r *rig) serve() {
	for topic, set := range reqTopics {
		for _, m := range r.take(topic) {
			var req struct {
				RequestID string `json:"request_id"`
				File      string
				Chunk     int
			}
			if json.Unmarshal(m.payload, &req) != nil {
				continue
			}
			r.served[set]++
			r.reqIDs[set] = append(r.reqIDs[set], req.RequestID)
			if r.drop[set] > 0 {
				r.drop[set]--
				continue
			}
			file, ok := r.files[set+"/"+req.File]
			if !ok {
				res, _ := json.Marshal(map[string]any{"request_id": req.RequestID, "error": map[string]string{"code": "not_found", "message": "no such file"}})
				r.m.inbound(r.topic(resTopics[set]), res)
				continue
			}
			frames := buildFrames(req.RequestID, file)
			if req.Chunk >= len(frames) {
				continue
			}
			r.m.inbound(r.topic(chunkTopics[set]), frames[req.Chunk])
		}
	}
}

// buildFrames makes the server's chunk frames for a file (§12.2).
func buildFrames(rid string, file []byte) [][]byte {
	sum := sha256.Sum256(file)
	h := ridHash(rid)
	count := max((len(file)+chunkSize-1)/chunkSize, 1)
	var out [][]byte
	for i := 0; i < count; i++ {
		data := file[min(i*chunkSize, len(file)):min((i+1)*chunkSize, len(file))]
		b := make([]byte, headerLen+len(data))
		copy(b, "RMFW")
		b[4], b[5] = 1, 1
		binary.LittleEndian.PutUint16(b[6:], headerLen)
		binary.LittleEndian.PutUint32(b[8:], uint32(i))
		binary.LittleEndian.PutUint32(b[12:], uint32(count))
		binary.LittleEndian.PutUint32(b[16:], uint32(len(file)))
		binary.LittleEndian.PutUint16(b[20:], uint16(len(data)))
		copy(b[24:], h[:])
		copy(b[32:], sum[:])
		copy(b[64:], data)
		out = append(out, b)
	}
	return out
}

// ---- paths and positions -----------------------------------------------------------

// geo is a point d metres east and n metres north of the simulator's origin.
func (r *rig) geo(east, north float64) [2]float64 {
	lat, lon := r.m.ap.toGeo(east, north)
	return [2]float64{roundTo(lat, 8), roundTo(lon, 8)}
}

type seg struct {
	Type   string       `json:"type"`
	Points [][2]float64 `json:"points"`
}

func pathFile(id string, segs ...seg) []byte {
	b, _ := json.Marshal(map[string]any{"path": id, "segments": segs})
	return b
}

func shaHex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// startPath puts a file in the path set and sends path_start.
func (r *rig) startPath(id string, file []byte, extra ...string) {
	r.files["path/"+id+".json"] = file
	params := append([]string{fmt.Sprintf(`"path":%q,"size":%d,"sha256":%q`, id, len(file), shaHex(file))}, extra...)
	r.cmd("autopilot", "c-"+id, "path_start", params...)
}

func pointsJSON(pts ...[2]float64) string {
	b, _ := json.Marshal(pts)
	return `"points":` + string(b)
}

func (r *rig) apState() map[string]any {
	r.t.Helper()
	msgs := r.msgs("autopilot/state")
	if len(msgs) == 0 {
		r.t.Fatal("no autopilot state published")
	}
	var s map[string]any
	_ = json.Unmarshal(msgs[len(msgs)-1].payload, &s)
	return s
}

func (r *rig) gwState() map[string]any {
	r.t.Helper()
	msgs := r.msgs("gateway/state")
	if len(msgs) == 0 {
		r.t.Fatal("no gateway state published")
	}
	var s map[string]any
	_ = json.Unmarshal(msgs[len(msgs)-1].payload, &s)
	return s
}

// drive sends one live-driving setpoint.
func (r *rig) drive(seq int, v, w float64) {
	body := fmt.Sprintf(`{"seq":%d,"time":%.3f,"v":%g,"w":%g}`, seq, tf(r.now), v, w)
	r.toMower("autopilot/drive", []byte(body))
}

// driveFor sends setpoints at 10 Hz for d.
func (r *rig) driveFor(seq *int, d time.Duration, v, w float64) {
	for t := time.Duration(0); t < d; t += 100 * time.Millisecond {
		*seq++
		r.drive(*seq, v, w)
		r.advance(100 * time.Millisecond)
	}
}

func approx(t *testing.T, name string, got, want, tol float64) {
	t.Helper()
	if d := got - want; d > tol || d < -tol {
		t.Fatalf("%s = %g, want %g ± %g", name, got, want, tol)
	}
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
