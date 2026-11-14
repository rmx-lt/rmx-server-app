-- +goose Up
-- Planning data, owned by the planning domain (wiki Server-App, "Planning API").
--
-- maps: one row per map a user drew in the web app. The drawing itself
-- (zones, start/end points, geo anchor, layer settings) is one JSON document
-- in doc, because the client always loads and saves a map as a whole.
-- revision counts the saves; a save names the revision it started from, so
-- two browsers can't silently overwrite each other.
-- user_settings: per-user key/value settings of the web app (UI preferences,
-- the default geo anchor for new maps).

CREATE TABLE maps (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Deleting a user deletes their maps.
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    revision   bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    doc        jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX maps_user_id_idx ON maps (user_id);

CREATE TABLE user_settings (
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key        text NOT NULL CHECK (key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
