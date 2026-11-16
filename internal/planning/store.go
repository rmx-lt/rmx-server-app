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

// All SQL of the planning domain, which owns the maps and user_settings
// tables. Each function runs on q: the pool, or a transaction
// from db.InTx. Every query is scoped to one user: another user's row is
// treated as not existing.

var (
	errNoMap         = errors.New("no such map")
	errStaleRevision = errors.New("stale revision")
)

func listMaps(ctx context.Context, q db.DBTX, userID core.UserID) ([]api.MapSummary, error) {
	rows, err := q.Query(ctx,
		`SELECT m.id, m.name, m.revision, m.updated_at,
		        count(*) FILTER (WHERE a->>'category' = 'mowing'),
		        count(*) FILTER (WHERE a->>'category' = 'no_go'),
		        count(*) FILTER (WHERE a->>'category' = 'navigation')
		 FROM maps m LEFT JOIN LATERAL jsonb_path_query(m.doc, '$.zones[*].areas[*]') a ON true
		 WHERE m.user_id = $1
		 GROUP BY m.id
		 ORDER BY m.updated_at DESC, m.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (api.MapSummary, error) {
		var s api.MapSummary
		err := row.Scan(&s.ID, &s.Name, &s.Revision, &s.UpdatedAt, &s.MowingAreaCount, &s.NoGoAreaCount, &s.NavigationAreaCount)
		return s, err
	})
}

func getMap(ctx context.Context, q db.DBTX, userID core.UserID, id int64) (api.MapDetail, error) {
	var m api.MapDetail
	var doc []byte
	err := q.QueryRow(ctx,
		`SELECT id, name, revision, updated_at, doc FROM maps WHERE id = $1 AND user_id = $2`,
		id, userID).Scan(&m.ID, &m.Name, &m.Revision, &m.UpdatedAt, &doc)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, errNoMap
	}
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(doc, &m.Doc); err != nil {
		return m, err
	}
	return m, nil
}

func insertMap(ctx context.Context, q db.DBTX, userID core.UserID, name string, doc []byte) (int64, int64, time.Time, error) {
	var id, revision int64
	var updated time.Time
	err := q.QueryRow(ctx,
		`INSERT INTO maps (user_id, name, doc) VALUES ($1, $2, $3)
		 RETURNING id, revision, updated_at`, userID, name, doc).Scan(&id, &revision, &updated)
	return id, revision, updated, err
}

// updateMap saves over revision and returns the new revision, or errNoMap, or errStaleRevision when the stored revision differs.
func updateMap(ctx context.Context, q db.DBTX, userID core.UserID, id, revision int64, name string, doc []byte) (int64, time.Time, error) {
	var next int64
	var updated time.Time
	err := q.QueryRow(ctx,
		`UPDATE maps
		 SET name = $4, doc = $5, revision = revision + 1, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND revision = $3
		 RETURNING revision, updated_at`, id, userID, revision, name, doc).Scan(&next, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := q.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM maps WHERE id = $1 AND user_id = $2)`,
			id, userID).Scan(&exists); err != nil {
			return 0, updated, err
		}
		if exists {
			return 0, updated, errStaleRevision
		}
		return 0, updated, errNoMap
	}
	return next, updated, err
}

func deleteMap(ctx context.Context, q db.DBTX, userID core.UserID, id int64) error {
	tag, err := q.Exec(ctx, `DELETE FROM maps WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNoMap
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
