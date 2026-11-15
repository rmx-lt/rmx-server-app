package mower

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

// Commands and acks (wiki Mower-Protocol §5). Only the server publishes
// commands. A command gets an id, is published on <board>/cmd, and is sent
// again with the same id when no ack comes within 5 s, up to 3 times; after
// that the outcome is unknown. A new boot value of the board fails every open
// command of it. The board answers with one final ack, and first with
// "accepted" when the command is long-running.

const (
	// AckTimeout is how long the server waits for an ack before it sends again (§5).
	AckTimeout = 5 * time.Second
	// MaxResends is how often a command is sent again (§5).
	MaxResends = 3
	// maxExpiresIn is the longest expires_in the API takes, in seconds.
	maxExpiresIn = 3600
	// tickInterval is how often the open commands and the monitor streams are looked at.
	tickInterval = 250 * time.Millisecond
)

// Error codes the server itself puts on a command; the boards' are in §5.
const (
	errBoardRestarted = "board_restarted"
	errNoAck          = "no_ack"
	errServerRestart  = "server_restarted"
)

// Publisher is the part of *mqtt.Client the service publishes with.
type Publisher interface {
	// Publish sends with QoS 1.
	Publish(ctx context.Context, device core.DeviceID, suffix string, payload []byte) error
	// PublishFast sends with QoS 0.
	PublishFast(ctx context.Context, device core.DeviceID, suffix string, payload []byte) error
}

// ---- Acks -----------------------------------------------------------------------------

// Ack is a parsed ack (§5).
type Ack struct {
	ID      string
	Cmd     string
	State   string // "accepted", "done" or "failed"
	Result  json.RawMessage
	Error   string
	Message string
}

// Final reports whether the ack ends the command.
func (a Ack) Final() bool { return a.State != "accepted" }

// ParseAck checks an ack: an id, and a state of accepted, done or failed.
// Other fields are kept as they are or ignored (§2).
func ParseAck(payload []byte) (Ack, error) {
	var raw struct {
		ID      string          `json:"id"`
		Cmd     string          `json:"cmd"`
		State   string          `json:"state"`
		Result  json.RawMessage `json:"result"`
		Error   *string         `json:"error"`
		Message *string         `json:"message"`
	}
	if err := decodeObject(payload, &raw); err != nil {
		return Ack{}, err
	}
	if !core.ValidID(raw.ID) {
		return Ack{}, errors.New("id is missing or not valid")
	}
	switch raw.State {
	case "accepted", "done", "failed":
	default:
		return Ack{}, fmt.Errorf("state %q is not accepted, done or failed", truncate(raw.State, 20))
	}
	a := Ack{ID: raw.ID, Cmd: raw.Cmd, State: raw.State}
	if r := bytes.TrimSpace(raw.Result); len(r) > 0 && string(r) != "null" {
		if r[0] != '{' {
			return Ack{}, errors.New("result is not an object")
		}
		a.Result = json.RawMessage(r)
	}
	if raw.Error != nil {
		a.Error = *raw.Error
	}
	if raw.Message != nil {
		a.Message = *raw.Message
	}
	return a, nil
}

// ---- The life of one command: pure transitions ---------------------------------------

func strp(s string) *string { return &s }

// isOpen reports whether a command still waits for its outcome.
func isOpen(c api.Command) bool {
	return c.State == api.CommandSent || c.State == api.CommandAccepted
}

// applyAck moves a command by an ack. It reports whether anything changed.
// A final ack is never overwritten, with one exception: a command the server
// failed because the board restarted may still get its own final ack, because
// the id is kept across a restart (an update ends that way, §6.5).
func applyAck(c api.Command, a Ack, now time.Time) (api.Command, bool) {
	revivable := c.State == api.CommandFailed && c.Error != nil && *c.Error == errBoardRestarted
	switch c.State {
	case api.CommandSent, api.CommandAccepted, api.CommandUnknown:
	case api.CommandFailed:
		if !revivable {
			return c, false
		}
	default:
		return c, false
	}
	if a.State == "accepted" {
		if c.State == api.CommandAccepted || revivable {
			return c, false
		}
		c.State = api.CommandAccepted
		c.UpdatedAt = now
		c.Error, c.Message = nil, nil
		if a.Result != nil {
			c.Result = a.Result
		}
		return c, true
	}
	c.UpdatedAt, c.FinishedAt = now, &now
	if a.Result != nil {
		c.Result = a.Result
	}
	c.Error, c.Message = nil, nil
	if a.State == "done" {
		c.State = api.CommandDone
		return c, true
	}
	c.State = api.CommandFailed
	code := a.Error
	if code == "" {
		code = "failed"
	}
	c.Error = &code
	if a.Message != "" {
		c.Message = strp(a.Message)
	}
	return c, true
}

// markLost ends a command that got no ack after the last resend.
func markLost(c api.Command, now time.Time) (api.Command, bool) {
	if !isOpen(c) {
		return c, false
	}
	c.State, c.UpdatedAt, c.FinishedAt = api.CommandUnknown, now, &now
	c.Error = strp(errNoAck)
	c.Message = strp("No ack after the last resend; read the board's state to see whether it ran")
	return c, true
}

// markBoardRestarted fails a command whose board started again (§5).
func markBoardRestarted(c api.Command, now time.Time) (api.Command, bool) {
	if !isOpen(c) {
		return c, false
	}
	c.State, c.UpdatedAt, c.FinishedAt = api.CommandFailed, now, &now
	c.Error = strp(errBoardRestarted)
	c.Message = strp("The board restarted; the command is gone")
	return c, true
}

// markServerRestarted closes a command the server lost track of when it stopped.
func markServerRestarted(c api.Command, now time.Time) (api.Command, bool) {
	if !isOpen(c) {
		return c, false
	}
	c.State, c.UpdatedAt, c.FinishedAt = api.CommandUnknown, now, &now
	c.Error = strp(errServerRestart)
	c.Message = strp("The server restarted while the command was open; read the board's state to see whether it ran")
	return c, true
}

// ---- The ledger: where commands are kept ----------------------------------------------

// ledger keeps the commands (the commands table). update reads a command,
// applies fn and stores the result if fn reports a change; it returns the
// stored command and whether it changed.
type ledger interface {
	insert(ctx context.Context, c api.Command) error
	update(ctx context.Context, id string, fn func(api.Command) (api.Command, bool)) (api.Command, bool, error)
	// openIDs lists the ids of the open commands of a board; board "" is every board of every device.
	openIDs(ctx context.Context, device core.DeviceID, board api.Board) ([]string, error)
}

// ---- The open commands ------------------------------------------------------------------

// pending is a command the server still waits for: the exact bytes to send
// again, and what to do with the outcome.
type pending struct {
	id      string
	device  core.DeviceID
	board   api.Board
	cmd     string
	payload []byte
	// sends is how often it has been published; nextAt when to look at it again.
	sends  int
	nextAt time.Time
	// accepted stops the resends: the board has it.
	accepted bool
	// persist: the command is in the ledger. Monitor keep-alives are not.
	persist bool
	// hook is told about every ack that changes the command, and with a
	// synthetic ack ("failed" and a server error code) when the command is lost.
	hook func(a Ack)
}

// outgoing is a command to send.
type outgoing struct {
	device core.DeviceID
	board  api.Board
	cmd    string
	// params are stored and shown; secret ones go on the wire only.
	params map[string]json.RawMessage
	secret map[string]json.RawMessage
	// expiresIn is seconds from now; 0 for none.
	expiresIn int
	by        *string
	persist   bool
	hook      func(a Ack)
}

func newID(prefix string) string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		panic("mower: no random numbers: " + err.Error())
	}
	return prefix + hex.EncodeToString(b)
}

// wire builds the command message (§5): id, cmd, expires_at, then the parameters.
func (o outgoing) wire(id string, now time.Time) ([]byte, error) {
	m := map[string]json.RawMessage{}
	for k, v := range o.params {
		m[k] = v
	}
	for k, v := range o.secret {
		m[k] = v
	}
	m["id"], _ = json.Marshal(id)
	m["cmd"], _ = json.Marshal(o.cmd)
	if o.expiresIn > 0 {
		m["expires_at"], _ = json.Marshal(now.Add(time.Duration(o.expiresIn) * time.Second).Unix())
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	if len(b) > MaxPayloadBytes {
		return nil, apperr.BadRequest("the command is %d bytes; a message is at most %d", len(b), MaxPayloadBytes)
	}
	return b, nil
}

func (o outgoing) storedParams() json.RawMessage {
	b, err := json.Marshal(o.params)
	if err != nil || len(o.params) == 0 {
		return json.RawMessage(`{}`)
	}
	return b
}

// dispatch creates a command, keeps it, and starts sending it. The first
// publish happens in the background; the resends follow from tick.
func (s *Service) dispatch(ctx context.Context, o outgoing) (api.Command, error) {
	if s.pub == nil {
		return api.Command{}, apperr.Internal(errors.New("commands are not connected to MQTT"))
	}
	now := s.now()
	id := newID("c-")
	payload, err := o.wire(id, now)
	if err != nil {
		return api.Command{}, err
	}
	cmd := api.Command{
		ID: id, Device: string(o.device), Board: o.board, Cmd: o.cmd, Params: o.storedParams(),
		State: api.CommandSent, Attempts: 1, RequestedBy: o.by, CreatedAt: now, UpdatedAt: now,
	}
	if o.persist {
		if err := s.cmds.ledger.insert(ctx, cmd); err != nil {
			return api.Command{}, apperr.DB(err)
		}
	}
	p := &pending{
		id: id, device: o.device, board: o.board, cmd: o.cmd, payload: payload,
		sends: 1, nextAt: now.Add(AckTimeout), persist: o.persist, hook: o.hook,
	}
	s.cmds.mu.Lock()
	s.cmds.open[id] = p
	s.cmds.mu.Unlock()
	if o.persist {
		s.send(api.MsgCommand{Command: cmd})
	}
	go s.transmit(p)
	return cmd, nil
}

// transmit publishes a pending command once (QoS 1). A failure is logged and
// counts as a send: the resend follows after the ack timeout.
func (s *Service) transmit(p *pending) {
	ctx, cancel := context.WithTimeout(s.runCtx(), 15*time.Second)
	defer cancel()
	if err := s.pub.Publish(ctx, p.device, string(p.board)+"/cmd", p.payload); err != nil && ctx.Err() == nil {
		slog.Warn("publishing a command failed", "device", string(p.device), "board", string(p.board), "cmd", p.cmd, "id", p.id, "error", err)
	}
}

// ---- Resend, outcome unknown ----------------------------------------------------------

// tick looks at the open commands: one with no ack after 5 s is sent again
// with the same id, up to 3 times; after the last resend and another 5 s its
// outcome is unknown. It also runs the monitor keep-alives.
func (s *Service) tick(ctx context.Context, now time.Time) {
	var resend, lost []*pending
	s.cmds.mu.Lock()
	for id, p := range s.cmds.open {
		if p.accepted || now.Before(p.nextAt) {
			continue
		}
		if p.sends < 1+MaxResends {
			p.sends++
			p.nextAt = now.Add(AckTimeout)
			resend = append(resend, p)
		} else {
			delete(s.cmds.open, id)
			lost = append(lost, p)
		}
	}
	s.cmds.mu.Unlock()

	for _, p := range resend {
		slog.Debug("sending a command again", "device", string(p.device), "id", p.id, "attempt", p.sends)
		go s.transmit(p)
		if p.persist {
			if c, changed, err := s.cmds.ledger.update(ctx, p.id, func(c api.Command) (api.Command, bool) {
				if !isOpen(c) {
					return c, false
				}
				c.Attempts, c.UpdatedAt = p.sends, now
				return c, true
			}); err == nil && changed {
				s.send(api.MsgCommand{Command: c})
			} else if err != nil && ctx.Err() == nil {
				slog.Error("storing a resend failed", "id", p.id, "error", err)
			}
		}
	}
	for _, p := range lost {
		slog.Warn("a command got no ack", "device", string(p.device), "board", string(p.board), "cmd", p.cmd, "id", p.id)
		s.finishLost(ctx, p, now)
	}
	s.monitorTick(ctx, now)
}

func (s *Service) finishLost(ctx context.Context, p *pending, now time.Time) {
	if p.persist {
		c, changed, err := s.cmds.ledger.update(ctx, p.id, func(c api.Command) (api.Command, bool) { return markLost(c, now) })
		switch {
		case err != nil && ctx.Err() == nil:
			slog.Error("storing a lost command failed", "id", p.id, "error", err)
		case changed:
			s.send(api.MsgCommand{Command: c})
		}
	}
	if p.hook != nil {
		p.hook(Ack{ID: p.id, Cmd: p.cmd, State: "failed", Error: errNoAck, Message: "no ack"})
	}
}

// ---- Acks arriving ------------------------------------------------------------------------

func (s *Service) ingestAck(ctx context.Context, device core.DeviceID, board api.Board, payload []byte) error {
	a, err := ParseAck(payload)
	if err != nil {
		return bad(err)
	}
	now := s.now()

	var p *pending
	s.cmds.mu.Lock()
	if q, ok := s.cmds.open[a.ID]; ok && q.device == device && q.board == board {
		p = q
		if a.Final() {
			delete(s.cmds.open, a.ID)
		} else {
			q.accepted = true
		}
	}
	s.cmds.mu.Unlock()

	changed := p != nil
	if p == nil || p.persist {
		// A persisted command, or one no longer open here (a late ack after
		// "unknown", or after a restart of the server).
		c, ok, err := s.cmds.ledger.update(ctx, a.ID, func(c api.Command) (api.Command, bool) {
			if c.Device != string(device) || c.Board != board {
				return c, false
			}
			return applyAck(c, a, now)
		})
		if err != nil {
			return err
		}
		if ok {
			s.send(api.MsgCommand{Command: c})
		}
		changed = changed || ok
	}
	if !changed {
		slog.Debug("ignoring an ack for a command that is not open", "device", string(device), "id", a.ID)
		return nil
	}
	if p != nil && p.hook != nil {
		p.hook(a)
	}
	return nil
}

// boardRestarted fails every open command of a board whose boot value changed (§5).
func (s *Service) boardRestarted(ctx context.Context, device core.DeviceID, board api.Board) {
	now := s.now()
	var gone []*pending
	s.cmds.mu.Lock()
	for id, p := range s.cmds.open {
		if p.device == device && p.board == board {
			delete(s.cmds.open, id)
			gone = append(gone, p)
		}
	}
	s.cmds.mu.Unlock()

	ids, err := s.cmds.ledger.openIDs(ctx, device, board)
	if err != nil {
		slog.Error("listing the open commands failed", "device", string(device), "error", err)
	}
	for _, id := range ids {
		c, changed, err := s.cmds.ledger.update(ctx, id, func(c api.Command) (api.Command, bool) { return markBoardRestarted(c, now) })
		switch {
		case err != nil:
			slog.Error("failing an open command failed", "id", id, "error", err)
		case changed:
			s.send(api.MsgCommand{Command: c})
		}
	}
	for _, p := range gone {
		if p.hook != nil {
			p.hook(Ack{ID: p.id, Cmd: p.cmd, State: "failed", Error: errBoardRestarted, Message: "the board restarted"})
		}
	}
}

// recoverOpen runs when the server starts: the commands that were open when it
// stopped are not waited for any more, and their outcome is unknown.
func (s *Service) recoverOpen(ctx context.Context) {
	now := s.now()
	ids, err := s.cmds.ledger.openIDs(ctx, "", "")
	if err != nil {
		slog.Error("listing the open commands failed", "error", err)
		return
	}
	for _, id := range ids {
		if _, _, err := s.cmds.ledger.update(ctx, id, func(c api.Command) (api.Command, bool) { return markServerRestarted(c, now) }); err != nil {
			slog.Error("closing an open command failed", "id", id, "error", err)
		}
	}
}

// ---- What a user may send --------------------------------------------------------------

// A parameter of a command: its name, its kind, and whether it is required.
type param struct {
	name     string
	kind     pkind
	required bool
}

type pkind int

const (
	pString   pkind = iota // 1 to 64 characters of [A-Za-z0-9._+-] (a version)
	pFile                  // a file name: 1 to 128 of [A-Za-z0-9._-], not a path
	pID                    // an id (§4)
	pBool                  //
	pPositive              // a number above 0 (a limit in m/s, a spacing in m)
	pCount                 // a whole number from 0 up to 2^32 - 1 (bytes, a point number)
	pSHA256                // 64 lower-case hex characters
	pPoints                // 1 to 100 points [lat, lon]
)

// commandSpecs lists the commands a user may send (§6.4, §8) and their
// parameters. Left out: monitor_start and monitor_stop (the monitor sends
// them), ntrip_set and ntrip_clear (the server sends them when its settings
// change).
var commandSpecs = map[api.Board]map[string][]param{
	api.BoardGateway: {
		"ping":    nil,
		"restart": nil,
		"ota": {
			{"version", pString, true}, {"file", pFile, false}, {"size", pCount, false},
		},
		"autopilot_reset": nil,
	},
	api.BoardAutopilot: {
		"stop":         nil,
		"manual_start": nil,
		"manual_stop":  nil,
		"blade":        {{"on", pBool, true}},
		"follow": {
			{"points", pPoints, true}, {"reverse", pBool, false}, {"blade", pBool, false}, {"speed", pPositive, false},
		},
		"record_start": {{"session", pID, true}, {"spacing", pPositive, false}},
		"record_stop":  nil,
		"job_start": {
			{"job", pID, true}, {"size", pCount, true}, {"sha256", pSHA256, true}, {"from_point", pCount, false},
		},
		"pause":       nil,
		"resume":      nil,
		"clear_fault": nil,
		"ota": {
			{"version", pString, true}, {"file", pFile, false}, {"size", pCount, false},
		},
		"restart": nil,
	},
}

var (
	versionRE = regexp.MustCompile(`^[A-Za-z0-9._+-]{1,64}$`)
	fileRE    = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
	sha256RE  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// maxPoints is how many points a follow command takes (§8).
const maxPoints = 100

// ParseCommandParams checks the parameters of a command a user asked for and
// returns them as they go on the wire. Unknown parameters are refused: the
// server sends only what the contract defines.
func ParseCommandParams(board api.Board, cmd string, raw *json.RawMessage) (map[string]json.RawMessage, error) {
	specs, ok := commandSpecs[board]
	if !ok {
		return nil, apperr.BadRequest("board must be gateway or autopilot")
	}
	spec, ok := specs[cmd]
	if !ok {
		switch cmd {
		case "monitor_start", "monitor_stop":
			return nil, apperr.BadRequest("%s is sent by the monitor: use the monitor_watch request on the WebSocket", cmd)
		case "ntrip_set", "ntrip_clear":
			return nil, apperr.BadRequest("%s is sent by the server when its NTRIP settings change", cmd)
		}
		return nil, apperr.BadRequest("%q is not a command of the %s", cmd, board)
	}
	given := map[string]json.RawMessage{}
	if raw != nil {
		b := bytes.TrimSpace(*raw)
		if len(b) > 0 && string(b) != "null" {
			dec := json.NewDecoder(bytes.NewReader(b))
			dec.UseNumber()
			if err := dec.Decode(&given); err != nil || given == nil {
				return nil, apperr.BadRequest("params must be an object")
			}
		}
	}
	out := map[string]json.RawMessage{}
	for _, p := range spec {
		v, present := given[p.name]
		if present && string(bytes.TrimSpace(v)) == "null" {
			present = false
		}
		delete(given, p.name)
		if !present {
			if p.required {
				return nil, apperr.BadRequest("%s needs the parameter %s", cmd, p.name)
			}
			continue
		}
		clean, err := checkParam(p, v)
		if err != nil {
			return nil, apperr.BadRequest("%s: parameter %s %v", cmd, p.name, err)
		}
		out[p.name] = clean
	}
	for name := range given {
		return nil, apperr.BadRequest("%s has no parameter %s", cmd, name)
	}
	return out, nil
}

func checkParam(p param, v json.RawMessage) (json.RawMessage, error) {
	v = bytes.TrimSpace(v)
	switch p.kind {
	case pString, pFile, pID, pSHA256:
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, errors.New("must be a string")
		}
		ok := false
		switch p.kind {
		case pString:
			ok = versionRE.MatchString(s)
		case pFile:
			ok = fileRE.MatchString(s) && s != "." && s != ".."
		case pID:
			ok = core.ValidID(s)
		case pSHA256:
			ok = sha256RE.MatchString(s)
		}
		if !ok {
			return nil, errors.New("is not valid")
		}
	case pBool:
		if string(v) != "true" && string(v) != "false" {
			return nil, errors.New("must be true or false")
		}
	case pPositive:
		f, err := strconv.ParseFloat(string(v), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f <= 0 || !numberLiteral(v) {
			return nil, errors.New("must be a number above 0")
		}
	case pCount:
		n, err := strconv.ParseUint(string(v), 10, 32)
		if err != nil || !numberLiteral(v) {
			return nil, errors.New("must be a whole number from 0 to 4294967295")
		}
		_ = n
	case pPoints:
		var pts [][]float64
		if err := json.Unmarshal(v, &pts); err != nil {
			return nil, errors.New("must be an array of [lat, lon]")
		}
		if len(pts) < 1 || len(pts) > maxPoints {
			return nil, fmt.Errorf("takes 1 to %d points", maxPoints)
		}
		for _, pt := range pts {
			if len(pt) != 2 || math.Abs(pt[0]) > 90 || math.Abs(pt[1]) > 180 {
				return nil, errors.New("must be points [lat, lon] in degrees")
			}
		}
	}
	return v, nil
}

// numberLiteral reports whether v is a plain JSON number (not a string or a bool).
func numberLiteral(v json.RawMessage) bool {
	return len(v) > 0 && (v[0] == '-' || (v[0] >= '0' && v[0] <= '9'))
}

// ---- Rules before a command is sent ------------------------------------------------------

// checkAllowed applies the rules of the contract on what the server may send
// to a device in its current state (§2, §7.1, §6.4):
//   - a board whose protocol the server does not support gets nothing but ota;
//   - the gateway is told to restart or update only while the autopilot is idle,
//     because both take the mower offline and pause a running job.
func checkAllowed(row deviceRow, board api.Board, cmd string) error {
	br := row.gateway
	if board == api.BoardAutopilot {
		br = row.autopilot
	}
	if br.state != nil && cmd != "ota" {
		if st, err := ParseState(br.state); err == nil && st.Protocol != "" && !ProtocolSupported(st.Protocol) {
			return apperr.Conflict("the %s reports protocol %s, which this server does not support; only ota is sent to it", board, st.Protocol)
		}
	}
	if row.gatewayStatus != nil && *row.gatewayStatus == StatusOffline {
		return apperr.Conflict("the mower is offline (the gateway reports offline)")
	}
	if board == api.BoardGateway && (cmd == "restart" || cmd == "ota") {
		return checkAutopilotIdle(row, cmd)
	}
	return nil
}

// checkAutopilotIdle refuses a gateway restart or update only when the
// autopilot is known and not idle. It is allowed when no autopilot state was
// ever received, and when the gateway's state reports the board link as not up
// ("down" or "incompatible"): then the autopilot cannot be working under the
// gateway's control. With the link up (or not reported), the autopilot's state
// must say "idle".
func checkAutopilotIdle(row deviceRow, cmd string) error {
	if row.autopilot.state == nil {
		return nil
	}
	if row.gateway.state != nil {
		if gw, err := ParseState(row.gateway.state); err == nil && gw.AutopilotLink != "" && gw.AutopilotLink != "up" {
			return nil
		}
	}
	st, err := ParseState(row.autopilot.state)
	if err != nil || st.Mode == "" {
		return apperr.Conflict("the gateway %s is refused: the autopilot's state does not say its mode", cmd)
	}
	if st.Mode != "idle" {
		return apperr.Conflict("the gateway %s is refused: the autopilot is %s, not idle", cmd, st.Mode)
	}
	return nil
}

// SendCommand sends a command a user asked for to one of a device's boards.
// It returns at once with the command in state "sent"; the outcome follows as
// pushed MsgCommand messages and in GET /api/devices/{name}/commands.
func (s *Service) SendCommand(ctx context.Context, user core.CurrentUser, device string, req api.CommandRequest) (api.Command, error) {
	id, ok := core.ParseDeviceID(device)
	if !ok {
		return api.Command{}, apperr.NotFound("device not found")
	}
	if req.Board != api.BoardGateway && req.Board != api.BoardAutopilot {
		return api.Command{}, apperr.BadRequest("board must be gateway or autopilot")
	}
	params, err := ParseCommandParams(req.Board, req.Cmd, req.Params)
	if err != nil {
		return api.Command{}, err
	}
	expires := 0
	if req.ExpiresIn != nil {
		if *req.ExpiresIn < 1 || *req.ExpiresIn > maxExpiresIn {
			return api.Command{}, apperr.BadRequest("expires_in must be 1 to %d seconds", maxExpiresIn)
		}
		expires = *req.ExpiresIn
	}
	row, err := getDevice(ctx, s.pool, id)
	if errors.Is(err, errNoDevice) {
		return api.Command{}, apperr.NotFound("device not found")
	}
	if err != nil {
		return api.Command{}, apperr.DB(err)
	}
	if err := checkAllowed(row, req.Board, req.Cmd); err != nil {
		return api.Command{}, err
	}
	by := user.Username
	return s.dispatch(ctx, outgoing{
		device: id, board: req.Board, cmd: req.Cmd, params: params, expiresIn: expires,
		by: &by, persist: true,
	})
}

// Commands lists a device's newest commands, newest first.
func (s *Service) Commands(ctx context.Context, name string, limit int) (api.CommandList, error) {
	id, ok := core.ParseDeviceID(name)
	if !ok {
		return api.CommandList{}, apperr.NotFound("device not found")
	}
	if limit == 0 {
		limit = defaultEvents
	}
	if limit < 1 || limit > maxEvents {
		return api.CommandList{}, apperr.BadRequest("limit must be 1 to %d", maxEvents)
	}
	if _, err := getDevice(ctx, s.pool, id); errors.Is(err, errNoDevice) {
		return api.CommandList{}, apperr.NotFound("device not found")
	} else if err != nil {
		return api.CommandList{}, apperr.DB(err)
	}
	cmds, err := listCommands(ctx, s.pool, id, limit)
	if err != nil {
		return api.CommandList{}, apperr.DB(err)
	}
	if cmds == nil {
		cmds = []api.Command{}
	}
	return api.CommandList{Commands: cmds}, nil
}

// Command returns one command of a device.
func (s *Service) Command(ctx context.Context, name, cmdID string) (api.Command, error) {
	id, ok := core.ParseDeviceID(name)
	if !ok || !core.ValidID(cmdID) {
		return api.Command{}, apperr.NotFound("command not found")
	}
	c, err := getCommand(ctx, s.pool, cmdID)
	if errors.Is(err, errNoCommand) || (err == nil && c.Device != string(id)) {
		return api.Command{}, apperr.NotFound("command not found")
	}
	if err != nil {
		return api.Command{}, apperr.DB(err)
	}
	return c, nil
}

// ---- The loop ----------------------------------------------------------------------------

type commander struct {
	mu     sync.Mutex
	open   map[string]*pending
	ledger ledger
}
