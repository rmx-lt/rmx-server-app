-- +goose Up
-- Paths the mower downloads over chunk transfer (wiki Mower-Protocol §11, §12;
-- wiki Server-App, "Chunk transfer").
--
-- paths: one row per path id. `doc` holds the file's bytes exactly as the mower
--   gets them (bytea, not jsonb: jsonb would change the bytes and so the hash).
--   size and sha256 are computed from `doc`, so they cannot disagree with it.
--   A path file is at most 1 MiB (§11).

CREATE TABLE paths (
    id         text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
    doc        bytea NOT NULL CHECK (octet_length(doc) <= 1048576),
    size       integer NOT NULL GENERATED ALWAYS AS (octet_length(doc)) STORED,
    sha256     bytea NOT NULL GENERATED ALWAYS AS (sha256(doc)) STORED,
    created_at timestamptz NOT NULL DEFAULT now()
);
