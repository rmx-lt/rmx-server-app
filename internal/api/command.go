package api

import (
	"encoding/json"
	"time"
)

// What the browser sends to a mower and what it sees back: commands (wiki
// Mower-Protocol §5, §6.4, §8), live driving (§9), monitor streams (§15) and
// the correction caster (§13). Only the server publishes to the mower; these
// are the requests the server accepts for that.

// CommandState says where a command is. "sent": published, no ack yet (the
// server sends it again after 5 s, up to 3 times). "accepted": a
// long-running command is running. "done" and "failed" are the board's final
// ack. "unknown": no ack came after the last resend, or the server restarted
// while the command was open; the outcome is read from the board's state.
type CommandState string

const (
	CommandSent     CommandState = "sent"
	CommandAccepted CommandState = "accepted"
	CommandDone     CommandState = "done"
	CommandFailed   CommandState = "failed"
	CommandUnknown  CommandState = "unknown"
)

// CommandRequest is the body of POST /api/devices/{name}/commands.
type CommandRequest struct {
	// "gateway" or "autopilot".
	Board Board `json:"board"`
	// The command name of wiki Mower-Protocol §6.4 or §8, except the monitor
	// commands (WebSocket monitor_watch) and ntrip_set / ntrip_clear (the
	// server sends those itself).
	Cmd string `json:"cmd"`
	// The command's parameters as one JSON object; null for none.
	Params *json.RawMessage `json:"params"`
	// The board refuses the command with "expired" this many seconds after the
	// server made it (and with "no_clock" when its clock is not set). Null for
	// no limit; at most 3600.
	ExpiresIn *int `json:"expires_in"`
}

// Command is one command the server sent, and what became of it.
type Command struct {
	// The command id (wiki Mower-Protocol §4).
	ID     string `json:"id"`
	Device string `json:"device"`
	Board  Board  `json:"board"`
	Cmd    string `json:"cmd"`
	// The parameters as sent. A secret is left out (ntrip_set's password).
	Params json.RawMessage `json:"params"`
	State  CommandState    `json:"state"`
	// The error code of a failed command: the board's (wiki Mower-Protocol §5)
	// or "board_restarted" (the board's boot value changed while the command was open).
	Error *string `json:"error"`
	// The board's text for people, or the server's.
	Message *string `json:"message"`
	// The result of the last ack that carried one; null for none.
	Result json.RawMessage `json:"result"`
	// How many times the command has been sent: 1 at first, up to 4.
	Attempts int `json:"attempts"`
	// The user who sent it; null for the server itself.
	RequestedBy *string    `json:"requested_by"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	FinishedAt  *time.Time `json:"finished_at"`
}

// CommandList is the answer to GET /api/devices/{name}/commands, newest first.
type CommandList struct {
	Commands []Command `json:"commands"`
}

// MsgCommand is pushed whenever a command is created or changes.
type MsgCommand struct {
	Command Command `json:"command"`
}

// ---- Live driving -------------------------------------------------------------------

// RequestDrive sets the live-driving setpoint of a device's autopilot (wiki
// Mower-Protocol §9). The server publishes it on autopilot/drive about 10
// times per second for as long as the client keeps sending: send it again
// every 100 to 200 ms while driving. A setpoint is not answered unless it
// failed. Stop sending to stop: the autopilot stops the motors by itself
// after 0.5 s without one.
type RequestDrive struct {
	Device string `json:"device"`
	// Forward speed, m/s; negative is backwards.
	V float64 `json:"v"`
	// Turn rate, rad/s; positive turns left.
	W float64 `json:"w"`
}

// ---- Monitor ------------------------------------------------------------------------

// MonitorState says where a monitor stream is: "starting" (monitor_start sent),
// "running" (the board accepted it), "failed" (the board refused it, or it was
// never acknowledged) or "stopped" (it ended: unwatched, the board restarted,
// or the watcher went away).
type MonitorState string

const (
	MonitorStarting MonitorState = "starting"
	MonitorRunning  MonitorState = "running"
	MonitorFailed   MonitorState = "failed"
	MonitorStopped  MonitorState = "stopped"
)

// RequestMonitorWatch asks for a fast stream of chosen metrics of one board
// (wiki Mower-Protocol §15) and keeps it alive: the server sends monitor_start
// again every few seconds while the last watch request is less than 15 s old,
// and stops the stream after that. Send it again every 5 to 10 s while the
// chart is open; the same metrics at the same rate share one stream. The
// samples arrive as MsgMonitorSamples, the state as MsgMonitor.
type RequestMonitorWatch struct {
	Device string `json:"device"`
	Board  Board  `json:"board"`
	// Metric names from the board's catalogue, one or more.
	Metrics []string `json:"metrics"`
	// Samples per second; one of the rates of every metric asked for.
	Rate float64 `json:"rate"`
}

// RequestMonitorUnwatch ends a stream at once.
type RequestMonitorUnwatch struct {
	Device string `json:"device"`
	// The session of a MonitorWatching.
	Session string `json:"session"`
}

// MonitorWatching is the answer to a watch: the stream the request is part of.
type MonitorWatching struct {
	Device  string       `json:"device"`
	Board   Board        `json:"board"`
	Session string       `json:"session"`
	State   MonitorState `json:"state"`
	Metrics []string     `json:"metrics"`
	Rate    float64      `json:"rate"`
	// The board's budget for the sum of metrics x rate over all its streams,
	// and how much of it is used, from its last monitor_start ack; null before the first.
	Budget *float64 `json:"budget"`
	Used   *float64 `json:"used"`
}

// RpcDone answers a request that has nothing to return.
type RpcDone struct{}

// MonitorStreams is the answer to GET /api/devices/{name}/monitor: the streams
// the server keeps alive for this device.
type MonitorStreams struct {
	Streams []MonitorWatching `json:"streams"`
}

// MsgMonitor is pushed when a stream changes state (or the board's budget changes).
type MsgMonitor struct {
	Stream MonitorWatching `json:"stream"`
	// The error code and text of a failed stream (the board's: over_budget,
	// bad_request, ...), or "no_ack"; null otherwise.
	Error   *string `json:"error"`
	Message *string `json:"message"`
}

// MsgMonitorSamples is pushed for every samples message of a stream someone watches.
type MsgMonitorSamples struct {
	Device  string `json:"device"`
	Board   Board  `json:"board"`
	Session string `json:"session"`
	// Number of the first sample, from 0 within the session; a jump is a lost message.
	Index int64 `json:"index"`
	// When the first sample was taken; sample k was taken at time + k / rate.
	Time    time.Time `json:"time"`
	Rate    float64   `json:"rate"`
	Metrics []string  `json:"metrics"`
	// One array per sample, one value per metric in the order of Metrics.
	Samples [][]*float64 `json:"samples"`
}

// ---- Corrections --------------------------------------------------------------------

// NtripSettings is the caster the server tells the gateways to use (wiki
// Mower-Protocol §13), without the password, which is never returned.
type NtripSettings struct {
	Configured bool   `json:"configured"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Mountpoint string `json:"mountpoint"`
	User       string `json:"user"`
	// True when a password is set.
	PasswordSet bool `json:"password_set"`
}
