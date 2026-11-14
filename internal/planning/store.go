package planning

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

// All SQL of the planning domain, which owns the environments and
// user_settings tables. Each function runs on q: the pool, or a transaction
// from db.InTx. Every query is scoped to one user: another user's row is
// treated as not existing.

var (
	errNoEnvironment = errors.New("no such environment")
	errStaleRevision = errors.New("stale revision")
)

func listEnvironments(ctx context.Context, q db.DBTX, userID core.UserID) ([]api.EnvironmentSummary, error) {
	rows, err := q.Query(ctx,
		`SELECT id, name, revision, updated_at,
		        (SELECT count(*) FROM jsonb_array_elements(doc->'objects') o WHERE o->>'category' = 'zone'),
		        (SELECT count(*) FROM jsonb_array_elements(doc->'objects') o WHERE o->>'category' = 'obstacle')
		 FROM environments WHERE user_id = $1
		 ORDER BY updated_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (api.EnvironmentSummary, error) {
		var s api.EnvironmentSummary
		err := row.Scan(&s.ID, &s.Name, &s.Revision, &s.UpdatedAt, &s.ZoneCount, &s.ObstacleCount)
		return s, err
	})
}

func getEnvironment(ctx context.Context, q db.DBTX, userID core.UserID, id int64) (api.Environment, error) {
	var env api.Environment
	var doc []byte
	err := q.QueryRow(ctx,
		`SELECT id, name, revision, updated_at, doc FROM environments WHERE id = $1 AND user_id = $2`,
		id, userID).Scan(&env.ID, &env.Name, &env.Revision, &env.UpdatedAt, &doc)
	if errors.Is(err, pgx.ErrNoRows) {
		return env, errNoEnvironment
	}
	if err != nil {
		return env, err
	}
	if err := json.Unmarshal(doc, &env.Doc); err != nil {
		return env, err
	}
	return env, nil
}

func insertEnvironment(ctx context.Context, q db.DBTX, userID core.UserID, name string, doc []byte) (int64, int64, time.Time, error) {
	var id, revision int64
	var updated time.Time
	err := q.QueryRow(ctx,
		`INSERT INTO environments (user_id, name, doc) VALUES ($1, $2, $3)
		 RETURNING id, revision, updated_at`, userID, name, doc).Scan(&id, &revision, &updated)
	return id, revision, updated, err
}

// updateEnvironment saves over revision and returns the new revision, or
// errNoEnvironment, or errStaleRevision when the stored revision differs.
func updateEnvironment(ctx context.Context, q db.DBTX, userID core.UserID, id, revision int64, name string, doc []byte) (int64, time.Time, error) {
	var next int64
	var updated time.Time
	err := q.QueryRow(ctx,
		`UPDATE environments
		 SET name = $4, doc = $5, revision = revision + 1, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND revision = $3
		 RETURNING revision, updated_at`, id, userID, revision, name, doc).Scan(&next, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := q.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM environments WHERE id = $1 AND user_id = $2)`,
			id, userID).Scan(&exists); err != nil {
			return 0, updated, err
		}
		if exists {
			return 0, updated, errStaleRevision
		}
		return 0, updated, errNoEnvironment
	}
	return next, updated, err
}

func deleteEnvironment(ctx context.Context, q db.DBTX, userID core.UserID, id int64) error {
	tag, err := q.Exec(ctx, `DELETE FROM environments WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNoEnvironment
	}
	return nil
}

func listSettings(ctx context.Context, q db.DBTX, userID core.UserID) ([]api.Setting, error) {
	rows, err := q.Query(ctx, `SELECT key, value FROM user_settings WHERE user_id = $1 ORDER BY key`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (api.Setting, error) {
		var s api.Setting
		var value []byte
		err := row.Scan(&s.Key, &value)
		s.Value = value
		return s, err
	})
}

func countSettings(ctx context.Context, q db.DBTX, userID core.UserID, except string) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM user_settings WHERE user_id = $1 AND key <> $2`, userID, except).Scan(&n)
	return n, err
}

func upsertSetting(ctx context.Context, q db.DBTX, userID core.UserID, key string, value []byte) error {
	_, err := q.Exec(ctx,
		`INSERT INTO user_settings (user_id, key, value) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		userID, key, value)
	return err
}

func deleteSetting(ctx context.Context, q db.DBTX, userID core.UserID, key string) error {
	_, err := q.Exec(ctx, `DELETE FROM user_settings WHERE user_id = $1 AND key = $2`, userID, key)
	return err
}
