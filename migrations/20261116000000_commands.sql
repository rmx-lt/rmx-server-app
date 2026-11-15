-- +goose Up
-- Commands the server sent to a mower, and what became of them (wiki
-- Server-App, "Mower commands"; contract: wiki Mower-Protocol §5).
--
-- commands: one row per command id. Only commands a user (or the server's
--   ntrip logic) sent are kept; the monitor keep-alives are not, they come
--   every few seconds. `params` never holds a secret: the password of
--   ntrip_set is left out before the row is written.
-- ntrip_sent: per device, a keyed fingerprint of the caster settings the
--   gateway acknowledged, so the settings go out once and again only when
--   they change. It is not the password and cannot be turned back into it.

CREATE TABLE commands (
    id          text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
    device      text NOT NULL REFERENCES devices (name) ON DELETE CASCADE,
    board       text NOT NULL CHECK (board IN ('gateway', 'autopilot')),
    cmd         text NOT NULL,
    params      jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
    -- sent: no ack yet. accepted: running. done / failed: the final ack.
    -- unknown: no ack after the last resend, or the server restarted while the command was open.
    state       text NOT NULL CHECK (state IN ('sent', 'accepted', 'done', 'failed', 'unknown')),
    error       text,
    message     text,
    result      jsonb,
    attempts    integer NOT NULL DEFAULT 1,
    requested_by text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE INDEX commands_device_idx ON commands (device, created_at DESC);
-- The open commands of a board, for the boot check and the restart of the server.
CREATE INDEX commands_open_idx ON commands (device, board) WHERE state IN ('sent', 'accepted');

CREATE TABLE ntrip_sent (
    device      text PRIMARY KEY REFERENCES devices (name) ON DELETE CASCADE,
    fingerprint text NOT NULL,
    sent_at     timestamptz NOT NULL DEFAULT now()
);
