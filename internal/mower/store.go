package mower

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/db"
)

// All SQL of the mower domain, which owns the devices, board_state,
// catalogue_parts, catalogues, device_events, metric_latest and telemetry
// tables. Each function runs on q: the pool, or a transaction from db.InTx.

var errNoDevice = errors.New("no such device")

// touchDevice creates the device on its first message and records that it was heard from.
func touchDevice(ctx context.Context, q db.DBTX, device core.DeviceID, at time.Time) error {
	_, err := q.Exec(ctx,
		`INSERT INTO devices (name, first_seen_at, last_seen_at) VALUES ($1, $2, $2)
		 ON CONFLICT (name) DO UPDATE SET last_seen_at = GREATEST(devices.last_seen_at, EXCLUDED.last_seen_at)`,
		string(device), at)
	return err
}

func setGatewayStatus(ctx context.Context, q db.DBTX, device core.DeviceID, status string, at time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE devices SET gateway_status = $2, gateway_status_at = $3 WHERE name = $1`,
		string(device), status, at)
	return err
}

// noteBoot records the boot counter a board sent. It reports whether the
// board has restarted: it had a boot value and this one differs (wiki
// Mower-Protocol §4.1). The first value the server sees is not a restart,
// and neither is a lower one: the counter only grows, so a lower value is a
// message that was held up (an event sent again) from before the restart.
func noteBoot(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board, boot int64, at time.Time) (restarted bool, err error) {
	var prev *int64
	err = q.QueryRow(ctx,
		`SELECT boot FROM board_state WHERE device = $1 AND board = $2 FOR UPDATE`,
		string(device), string(board)).Scan(&prev)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if prev != nil && boot <= *prev {
		return false, nil
	}
	_, err = q.Exec(ctx,
		`INSERT INTO board_state (device, board, boot, boot_seen_at) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (device, board) DO UPDATE SET boot = EXCLUDED.boot, boot_seen_at = EXCLUDED.boot_seen_at`,
		string(device), string(board), boot, at)
	return prev != nil, err
}

// saveState keeps the board's state message as published.
func saveState(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board, state []byte, at time.Time) error {
	_, err := q.Exec(ctx,
		`INSERT INTO board_state (device, board, state, state_received_at) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (device, board) DO UPDATE SET state = EXCLUDED.state, state_received_at = EXCLUDED.state_received_at`,
		string(device), string(board), state, at)
	return err
}

// ---- Catalogues ---------------------------------------------------------------------------

func savePart(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board, part string, revision int64, doc []byte, at time.Time) error {
	_, err := q.Exec(ctx,
		`INSERT INTO catalogue_parts (device, board, part, revision, doc, received_at) VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (device, board, part) DO UPDATE SET revision = EXCLUDED.revision, doc = EXCLUDED.doc, received_at = EXCLUDED.received_at`,
		string(device), string(board), part, revision, doc, at)
	return err
}

// loadParts returns every stored catalogue message of a board by part name.
func loadParts(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board) (map[string][]byte, error) {
	rows, err := q.Query(ctx, `SELECT part, doc FROM catalogue_parts WHERE device = $1 AND board = $2`, string(device), string(board))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]byte{}
	for rows.Next() {
		var part string
		var doc []byte
		if err := rows.Scan(&part, &doc); err != nil {
			return nil, err
		}
		out[part] = doc
	}
	return out, rows.Err()
}

// saveCatalogue stores the catalogue in use and reports whether it differs from the one before.
func saveCatalogue(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board, cat api.BoardCatalogue, at time.Time) (changed bool, err error) {
	doc, err := json.Marshal(cat)
	if err != nil {
		return false, err
	}
	var same bool
	err = q.QueryRow(ctx, `SELECT doc = $3::jsonb FROM catalogues WHERE device = $1 AND board = $2`,
		string(device), string(board), doc).Scan(&same)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if same {
		return false, nil
	}
	_, err = q.Exec(ctx,
		`INSERT INTO catalogues (device, board, revision, doc, updated_at) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (device, board) DO UPDATE SET revision = EXCLUDED.revision, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
		string(device), string(board), *cat.Revision, doc, at)
	return err == nil, err
}

// loadCatalogues returns the catalogues in use of a device, by board.
func loadCatalogues(ctx context.Context, q db.DBTX, device core.DeviceID) (map[api.Board]api.BoardCatalogue, error) {
	rows, err := q.Query(ctx, `SELECT board, doc FROM catalogues WHERE device = $1`, string(device))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[api.Board]api.BoardCatalogue{}
	for rows.Next() {
		var board string
		var doc []byte
		if err := rows.Scan(&board, &doc); err != nil {
			return nil, err
		}
		var c api.BoardCatalogue
		if err := json.Unmarshal(doc, &c); err != nil {
			return nil, err
		}
		out[api.Board(board)] = c
	}
	return out, rows.Err()
}

// ---- Events -------------------------------------------------------------------------------

// saveEvent stores an event unless its (board, boot, seq) is already stored;
// it reports whether the event was new.
func saveEvent(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board, e Event, at time.Time, arrived time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`INSERT INTO device_events (device, board, boot, seq, time, event, data, received_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (device, board, boot, seq) DO NOTHING`,
		string(device), string(board), e.Boot, e.Seq, at, e.Name, []byte(e.Data), arrived)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func listEvents(ctx context.Context, q db.DBTX, device core.DeviceID, limit int) ([]api.DeviceEvent, error) {
	rows, err := q.Query(ctx,
		`SELECT board, boot, seq, time, event, data, received_at FROM device_events
		 WHERE device = $1 ORDER BY time DESC, boot DESC, seq DESC LIMIT $2`, string(device), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (api.DeviceEvent, error) {
		var e api.DeviceEvent
		var board string
		var data []byte
		err := row.Scan(&board, &e.Boot, &e.Seq, &e.Time, &e.Event, &data, &e.ReceivedAt)
		e.Board, e.Data = api.Board(board), json.RawMessage(data)
		return e, err
	})
}

// ---- Telemetry ----------------------------------------------------------------------------

// saveTelemetry stores one message: every known value into the time series,
// and every value (known or not) as the metric's latest.
func saveTelemetry(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board, boot int64, at time.Time, readings []Reading) error {
	names := make([]string, 0, len(readings))
	values := make([]*float64, 0, len(readings))
	for _, r := range readings {
		names = append(names, r.Metric)
		values = append(values, r.Value)
	}
	if len(names) == 0 {
		return nil
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO telemetry (time, device, board, metric, boot, value)
		 SELECT $1::timestamptz, $2::text, $3::text, m.metric, $4::bigint, m.value FROM unnest($5::text[], $6::float8[]) AS m(metric, value)
		 WHERE m.value IS NOT NULL`,
		at, string(device), string(board), boot, names, values); err != nil {
		return err
	}
	_, err := q.Exec(ctx,
		`INSERT INTO metric_latest (device, board, metric, time, boot, value)
		 SELECT $2::text, $3::text, m.metric, $1::timestamptz, $4::bigint, m.value FROM unnest($5::text[], $6::float8[]) AS m(metric, value)
		 ON CONFLICT (device, board, metric) DO UPDATE SET time = EXCLUDED.time, boot = EXCLUDED.boot, value = EXCLUDED.value
		 WHERE metric_latest.time <= EXCLUDED.time`,
		at, string(device), string(board), boot, names, values)
	return err
}

func listLatest(ctx context.Context, q db.DBTX, device core.DeviceID) ([]api.LatestValue, error) {
	rows, err := q.Query(ctx,
		`SELECT board, metric, time, boot, value FROM metric_latest WHERE device = $1 ORDER BY board, metric`, string(device))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (api.LatestValue, error) {
		var v api.LatestValue
		var board string
		err := row.Scan(&board, &v.Metric, &v.Time, &v.Boot, &v.Value)
		v.Board = api.Board(board)
		return v, err
	})
}

// history returns the newest limit samples of a metric in [from, to], oldest
// first, and whether more matched.
func history(ctx context.Context, q db.DBTX, device core.DeviceID, board api.Board, metric string, from, to time.Time, limit int) ([]Sample, bool, error) {
	rows, err := q.Query(ctx,
		`SELECT time, boot, value FROM telemetry
		 WHERE device = $1 AND board = $2 AND metric = $3 AND time >= $4 AND time <= $5
		 ORDER BY time DESC LIMIT $6`,
		string(device), string(board), metric, from, to, limit+1)
	if err != nil {
		return nil, false, err
	}
	samples, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Sample, error) {
		var s Sample
		err := row.Scan(&s.Time, &s.Boot, &s.Value)
		return s, err
	})
	if err != nil {
		return nil, false, err
	}
	truncated := len(samples) > limit
	if truncated {
		samples = samples[:limit]
	}
	for i, j := 0, len(samples)-1; i < j; i, j = i+1, j-1 {
		samples[i], samples[j] = samples[j], samples[i]
	}
	return samples, truncated, nil
}

// ---- Devices ------------------------------------------------------------------------------

type deviceRow struct {
	name          string
	firstSeen     time.Time
	lastSeen      time.Time
	gatewayStatus *string
	gateway       boardRow
	autopilot     boardRow
}

type boardRow struct {
	boot       *int64
	bootSeenAt *time.Time
	state      []byte
	receivedAt *time.Time
}

const deviceSelect = `
	SELECT d.name, d.first_seen_at, d.last_seen_at, d.gateway_status,
	       g.boot, g.boot_seen_at, g.state, g.state_received_at,
	       a.boot, a.boot_seen_at, a.state, a.state_received_at
	FROM devices d
	LEFT JOIN board_state g ON g.device = d.name AND g.board = 'gateway'
	LEFT JOIN board_state a ON a.device = d.name AND a.board = 'autopilot'`

func scanDevice(row pgx.Row) (deviceRow, error) {
	var d deviceRow
	err := row.Scan(&d.name, &d.firstSeen, &d.lastSeen, &d.gatewayStatus,
		&d.gateway.boot, &d.gateway.bootSeenAt, &d.gateway.state, &d.gateway.receivedAt,
		&d.autopilot.boot, &d.autopilot.bootSeenAt, &d.autopilot.state, &d.autopilot.receivedAt)
	return d, err
}

func listDevices(ctx context.Context, q db.DBTX) ([]deviceRow, error) {
	rows, err := q.Query(ctx, deviceSelect+` ORDER BY d.name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (deviceRow, error) { return scanDevice(row) })
}

func getDevice(ctx context.Context, q db.DBTX, device core.DeviceID) (deviceRow, error) {
	d, err := scanDevice(q.QueryRow(ctx, deviceSelect+` WHERE d.name = $1`, string(device)))
	if errors.Is(err, pgx.ErrNoRows) {
		return d, errNoDevice
	}
	return d, err
}

// ---- Commands -----------------------------------------------------------------------------

var errNoCommand = errors.New("no such command")

const commandColumns = `id, device, board, cmd, params, state, error, message, result, attempts, requested_by, created_at, updated_at, finished_at`

func scanCommand(row pgx.Row) (api.Command, error) {
	var c api.Command
	var board, state string
	var params, result []byte
	err := row.Scan(&c.ID, &c.Device, &board, &c.Cmd, &params, &state, &c.Error, &c.Message, &result,
		&c.Attempts, &c.RequestedBy, &c.CreatedAt, &c.UpdatedAt, &c.FinishedAt)
	c.Board, c.State = api.Board(board), api.CommandState(state)
	c.Params, c.Result = json.RawMessage(params), json.RawMessage(result)
	return c, err
}

func getCommand(ctx context.Context, q db.DBTX, id string) (api.Command, error) {
	c, err := scanCommand(q.QueryRow(ctx, `SELECT `+commandColumns+` FROM commands WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return c, errNoCommand
	}
	return c, err
}

func listCommands(ctx context.Context, q db.DBTX, device core.DeviceID, limit int) ([]api.Command, error) {
	rows, err := q.Query(ctx,
		`SELECT `+commandColumns+` FROM commands WHERE device = $1 ORDER BY created_at DESC, id LIMIT $2`, string(device), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (api.Command, error) { return scanCommand(row) })
}

// dbLedger keeps the commands in the commands table.
type dbLedger struct{ pool *db.Pool }

func (l dbLedger) insert(ctx context.Context, c api.Command) error {
	_, err := l.pool.Exec(ctx,
		`INSERT INTO commands (id, device, board, cmd, params, state, attempts, requested_by, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
		c.ID, c.Device, string(c.Board), c.Cmd, []byte(c.Params), string(c.State), c.Attempts, c.RequestedBy, c.CreatedAt)
	return err
}

func (l dbLedger) update(ctx context.Context, id string, fn func(api.Command) (api.Command, bool)) (api.Command, bool, error) {
	var out api.Command
	var changed bool
	err := db.InTx(ctx, l.pool, func(tx db.DBTX) error {
		cur, err := scanCommand(tx.QueryRow(ctx, `SELECT `+commandColumns+` FROM commands WHERE id = $1 FOR UPDATE`, id))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		out = cur
		next, ok := fn(cur)
		if !ok {
			return nil
		}
		var result []byte
		if next.Result != nil {
			result = []byte(next.Result)
		}
		_, err = tx.Exec(ctx,
			`UPDATE commands SET state = $2, error = $3, message = $4, result = $5, attempts = $6, updated_at = $7, finished_at = $8 WHERE id = $1`,
			id, string(next.State), next.Error, next.Message, result, next.Attempts, next.UpdatedAt, next.FinishedAt)
		out, changed = next, err == nil
		return err
	})
	return out, changed, err
}

func (l dbLedger) openIDs(ctx context.Context, device core.DeviceID, board api.Board) ([]string, error) {
	var rows pgx.Rows
	var err error
	if device == "" {
		rows, err = l.pool.Query(ctx, `SELECT id FROM commands WHERE state IN ('sent', 'accepted')`)
	} else {
		rows, err = l.pool.Query(ctx, `SELECT id FROM commands WHERE device = $1 AND board = $2 AND state IN ('sent', 'accepted')`, string(device), string(board))
	}
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// ---- Corrections --------------------------------------------------------------------------

// ntripFingerprint is the fingerprint of the caster settings the gateway of
// device last acknowledged; "" for none.
func ntripFingerprint(ctx context.Context, q db.DBTX, device core.DeviceID) (string, error) {
	var fp string
	err := q.QueryRow(ctx, `SELECT fingerprint FROM ntrip_sent WHERE device = $1`, string(device)).Scan(&fp)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return fp, err
}

func saveNtripFingerprint(ctx context.Context, q db.DBTX, device core.DeviceID, fp string, at time.Time) error {
	_, err := q.Exec(ctx,
		`INSERT INTO ntrip_sent (device, fingerprint, sent_at) VALUES ($1, $2, $3)
		 ON CONFLICT (device) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, sent_at = EXCLUDED.sent_at`,
		string(device), fp, at)
	return err
}

func deleteNtripFingerprint(ctx context.Context, q db.DBTX, device core.DeviceID) error {
	_, err := q.Exec(ctx, `DELETE FROM ntrip_sent WHERE device = $1`, string(device))
	return err
}
