-- +goose Up
-- The records feature (the probe's CRUD toy problem) is gone: drop its tables
-- and types. Dropping the record_events hypertable also removes its chunks and
-- its compression and retention policies.
-- The migrations that created them stay as they are, so a fresh database still
-- runs the same sequence.

DROP TABLE IF EXISTS record_events;
DROP TABLE IF EXISTS records;
DROP TYPE IF EXISTS record_op;
DROP TYPE IF EXISTS connection_type;
