-- +goose Up
-- Mower data, owned by the mower domain (wiki Server-App, "Mower ingest").
-- Everything here comes from the topics under mower/<name>/gateway/ and
-- mower/<name>/autopilot/ (wiki Mower-Protocol). The server keeps what the
-- boards send and holds no formulas or hardware constants.
--
-- devices: one row per device name seen on a topic.
-- board_state: per device and board, the last retained state message as sent
--   and the last boot counter seen in any message of that board.
-- catalogue_parts: every catalogue message as received (the "index" part and
--   the others), so a catalogue can be assembled in any arrival order.
-- catalogues: the catalogue in use per board, written only when the index and
--   every part it lists are present with the index's revision.
-- device_events: autopilot events, one row per (board, boot, seq).
-- metric_latest: the newest value of each metric.
-- telemetry: every metric value as a time series by name (hypertable).

CREATE TABLE devices (
    name             text PRIMARY KEY CHECK (name ~ '^[A-Za-z0-9_-]{1,64}$'),
    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    -- The gateway's retained status: 'online' or 'offline'; null before the first.
    gateway_status    text CHECK (gateway_status IN ('online', 'offline')),
    gateway_status_at timestamptz
);

CREATE TABLE board_state (
    device            text NOT NULL REFERENCES devices (name) ON DELETE CASCADE,
    board             text NOT NULL CHECK (board IN ('gateway', 'autopilot')),
    -- Last boot counter seen in any message of the board; null before the first.
    boot              bigint,
    boot_seen_at      timestamptz,
    -- Last state message, as published; null if none arrived.
    state             jsonb CHECK (jsonb_typeof(state) = 'object'),
    state_received_at timestamptz,
    PRIMARY KEY (device, board)
);

CREATE TABLE catalogue_parts (
    device      text NOT NULL REFERENCES devices (name) ON DELETE CASCADE,
    board       text NOT NULL CHECK (board IN ('gateway', 'autopilot')),
    -- 'index' or a part name.
    part        text NOT NULL CHECK (part ~ '^[a-z0-9_-]{1,32}$'),
    revision    bigint NOT NULL,
    doc         jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object'),
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device, board, part)
);

CREATE TABLE catalogues (
    device      text NOT NULL REFERENCES devices (name) ON DELETE CASCADE,
    board       text NOT NULL CHECK (board IN ('gateway', 'autopilot')),
    revision    bigint NOT NULL,
    -- The assembled catalogue (api.BoardCatalogue).
    doc         jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object'),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device, board)
);

CREATE TABLE device_events (
    device      text NOT NULL REFERENCES devices (name) ON DELETE CASCADE,
    board       text NOT NULL CHECK (board IN ('gateway', 'autopilot')),
    boot        bigint NOT NULL,
    seq         bigint NOT NULL,
    time        timestamptz NOT NULL,
    event       text NOT NULL,
    -- The event's fields besides time, boot, seq and event.
    data        jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    received_at timestamptz NOT NULL DEFAULT now(),
    -- An event whose boot and seq the server has seen is dropped (wiki Mower-Protocol §7.3).
    PRIMARY KEY (device, board, boot, seq)
);

CREATE INDEX device_events_time_idx ON device_events (device, time DESC);

CREATE TABLE metric_latest (
    device  text NOT NULL REFERENCES devices (name) ON DELETE CASCADE,
    board   text NOT NULL CHECK (board IN ('gateway', 'autopilot')),
    metric  text NOT NULL,
    time    timestamptz NOT NULL,
    boot    bigint NOT NULL,
    -- A bool is 0 or 1, an enum its index; null when the board said it is not known.
    value   double precision,
    PRIMARY KEY (device, board, metric)
);

-- Time series by metric name. No foreign key: a hypertable row is written for
-- every value, and old data may outlive a device row. A counter's value is
-- the count since boot; boot says which start it counts from.
-- Chunks are daily and compressed after a day. There is no retention policy yet.
CREATE TABLE telemetry (
    time   timestamptz NOT NULL,
    device text NOT NULL,
    board  text NOT NULL CHECK (board IN ('gateway', 'autopilot')),
    metric text NOT NULL,
    boot   bigint NOT NULL,
    value  double precision NOT NULL
);

SELECT create_hypertable('telemetry', by_range('time', INTERVAL '1 day'));

CREATE INDEX telemetry_series_idx ON telemetry (device, board, metric, time DESC);

ALTER TABLE telemetry SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device, board, metric',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('telemetry', INTERVAL '1 day');
