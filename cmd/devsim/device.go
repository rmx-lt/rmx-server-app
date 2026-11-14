package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sync"
	"time"
)

// The command contract is the gateway firmware's (rmx-mower-gateway
// main/remote_cmd.h and main/ota.c): same command names, reply fields, error
// codes and messages, so a UI built against the simulator works with the
// board.

const knownCommands = "known: ping status gps ota restart"

var fwFileName = regexp.MustCompile(`^[A-Za-z0-9._-]+\.bin$`)

// reply is the JSON on mower/<name>/cmd/ack, in the firmware's field order.
type reply struct {
	ID      string `json:"id"`
	Cmd     string `json:"cmd"`
	OK      bool   `json:"ok"`
	Result  any    `json:"result,omitempty"`
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
	MS      int64  `json:"ms"`
	Time    int64  `json:"time,omitempty"`
}

type otaStatus struct {
	State    string `json:"state"`
	Version  string `json:"version,omitempty"`
	Progress *int   `json:"progress,omitempty"`
	Error    string `json:"error,omitempty"`
}

type statusResult struct {
	UptimeS      int64     `json:"uptime_s"`
	PPP          bool      `json:"ppp"`
	RSSI         int       `json:"rssi"`
	FreeHeap     int       `json:"free_heap"`
	FreeInternal int       `json:"free_internal"`
	MinFreeHeap  int       `json:"min_free_heap"`
	Clock        bool      `json:"clock"`
	Version      string    `json:"version"`
	Partition    string    `json:"partition"`
	Confirmed    bool      `json:"confirmed"`
	OTA          otaStatus `json:"ota"`
}

// device is the simulated gateway's state. Its methods are safe to call from
// several goroutines.
type device struct {
	name string
	now  func() time.Time
	lat  float64
	lon  float64

	mu        sync.Mutex
	version   string
	partition string
	booted    time.Time
	seen      []string // last command ids, newest last
	busy      bool
	ota       otaStatus
}

func newDevice(name, version string, now func() time.Time) *device {
	return &device{
		name: name, now: now, lat: 54.687157, lon: 25.279652,
		version: version, partition: "ota_0", booted: now(),
		ota: otaStatus{State: "idle"},
	}
}

// otaJob is an accepted ota command: run it after the "started" ack is sent.
type otaJob struct {
	id, file, version string
	size              int64
	from              string
}

// handle answers one command. A nil reply means "ignore" (a duplicate id).
// A non-nil job is an update to run after the reply; restart asks for a
// simulated reboot after the reply.
func (d *device) handle(payload []byte) (r *reply, job *otaJob, restart bool) {
	t0 := d.now()
	var cmd map[string]json.RawMessage
	jsonErr := json.Unmarshal(payload, &cmd)
	id, idOK := str(cmd["id"])
	name, nameOK := str(cmd["cmd"])
	r = &reply{ID: id, Cmd: name}

	d.mu.Lock()
	defer d.mu.Unlock()
	switch {
	case jsonErr != nil || !idOK || id == "" || len(id) > 64 || !nameOK:
		r.fail("bad_request", `need a JSON object with string "id" (1-64 chars) and "cmd"`)
	case d.seenBefore(id):
		return nil, nil, false
	case cmd["expires_at"] != nil && !isNumber(cmd["expires_at"]):
		r.fail("bad_request", "expires_at must be a unix time in seconds")
	case cmd["expires_at"] != nil && number(cmd["expires_at"]) < float64(t0.Unix()):
		r.fail("expired", "command expired before it arrived")
	case name == "ping":
		r.OK, r.Result = true, map[string]string{"pong": d.name}
	case name == "status":
		r.OK, r.Result = true, d.statusLocked()
	case name == "gps":
		if d.busy {
			r.fail("busy", "no GPS reads during an update (they pause PPP)")
		} else {
			utc := t0.UTC().Format("2006-01-02T15:04:05Z")
			r.OK, r.Result = true, map[string]any{
				"location": fmt.Sprintf(`{"gps":"fix","lat":%.6f,"lon":%.6f,"alt":112.0,"utc":"%s","sats":9,"hdop":0.9,"mode":"3D"}`, d.lat, d.lon, utc),
				"gps_fix":  true,
				"gps":      fmt.Sprintf("fix (3D, 9 sats, %s)", utc),
			}
		}
	case name == "ota":
		job = d.startOTALocked(r, cmd)
	case name == "restart":
		r.OK, restart = true, true
	default:
		r.fail("unknown_cmd", knownCommands)
	}
	r.MS = d.now().Sub(t0).Milliseconds()
	r.Time = d.now().Unix()
	return r, job, restart
}

func (r *reply) fail(code, message string) {
	r.OK, r.Error, r.Message = false, code, message
}

func (d *device) seenBefore(id string) bool {
	for _, s := range d.seen {
		if s == id {
			return true
		}
	}
	d.seen = append(d.seen, id)
	if len(d.seen) > 16 {
		d.seen = d.seen[1:]
	}
	return false
}

func (d *device) statusLocked() statusResult {
	return statusResult{
		UptimeS: int64(d.now().Sub(d.booted).Seconds()), PPP: true, RSSI: 22,
		FreeHeap: 4365000, FreeInternal: 273000, MinFreeHeap: 4317000, Clock: true,
		Version: d.version, Partition: d.partition, Confirmed: true, OTA: d.ota,
	}
}

func (d *device) startOTALocked(r *reply, cmd map[string]json.RawMessage) *otaJob {
	version, _ := str(cmd["version"])
	file, _ := str(cmd["file"])
	if url, _ := str(cmd["url"]); file == "" && url != "" {
		file = lastSegment(url)
	} else if file == "" && version != "" {
		file = version + ".bin"
	}
	var size float64
	if cmd["size"] != nil {
		if !isNumber(cmd["size"]) {
			r.fail("bad_request", "size must be the image size in bytes")
			return nil
		}
		size = number(cmd["size"])
	}
	switch {
	case len(file) > 128 || !fwFileName.MatchString(file):
		r.fail("bad_request", "ota needs a file name [A-Za-z0-9._-]+.bin (or a version, used as <version>.bin)")
	case version == "" || len(version) > 31:
		r.fail("bad_request", "ota needs a string version (1-31 chars)")
	case size < 0:
		r.fail("bad_request", "size must be the image size in bytes")
	case version == d.version:
		r.fail("same_version", "this version is already running")
	case d.busy:
		r.fail("busy", "an update is already running")
	default:
		zero := 0
		d.busy = true
		d.ota = otaStatus{State: "downloading", Version: version, Progress: &zero}
		r.OK, r.Result = true, map[string]string{"state": "started", "version": version}
		return &otaJob{id: r.ID, file: file, version: version, size: int64(size), from: d.version}
	}
	return nil
}

// progress records the download progress (0..100) for status.
func (d *device) progress(p int) {
	d.mu.Lock()
	d.ota.Progress = &p
	d.mu.Unlock()
}

// finishOTA ends an update. On success the device "restarts" into the new
// version on the other partition; the caller does the reconnect.
func (d *device) finishOTA(job *otaJob, code string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.busy = false
	if code != "" {
		d.ota.State, d.ota.Error = "failed", code
		return
	}
	d.ota = otaStatus{State: "idle"}
	d.version = job.version
	if d.partition == "ota_0" {
		d.partition = "ota_1"
	} else {
		d.partition = "ota_0"
	}
}

// boot resets the uptime, as after a restart.
func (d *device) boot() {
	d.mu.Lock()
	d.booted = d.now()
	d.mu.Unlock()
}

// otaAck is the second ota ack: "done", or the error.
func (d *device) otaAck(job *otaJob, t0 time.Time, code, message string) *reply {
	r := &reply{ID: job.id, Cmd: "ota"}
	if code != "" {
		r.fail(code, message)
	} else {
		r.OK, r.Result = true, map[string]string{"state": "done", "version": job.version, "from": job.from}
	}
	r.MS = d.now().Sub(t0).Milliseconds()
	r.Time = d.now().Unix()
	return r
}

// firmwareReport is the retained message on mower/<name>/firmware after an
// update (ota_report_update in the firmware).
func (d *device) firmwareReport(previous string) map[string]any {
	d.mu.Lock()
	defer d.mu.Unlock()
	return map[string]any{"version": d.version, "previous": previous, "partition": d.partition, "time": d.now().Unix()}
}

func str(raw json.RawMessage) (string, bool) {
	var s string
	if raw == nil || json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

func isNumber(raw json.RawMessage) bool {
	var f float64
	return json.Unmarshal(raw, &f) == nil
}

func number(raw json.RawMessage) float64 {
	var f float64
	_ = json.Unmarshal(raw, &f)
	return f
}

func lastSegment(url string) string {
	for i := len(url) - 1; i >= 0; i-- {
		if url[i] == '/' {
			url = url[i+1:]
			break
		}
	}
	for i := 0; i < len(url); i++ {
		if url[i] == '?' {
			return url[:i]
		}
	}
	return url
}
