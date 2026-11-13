package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/db"
)

// All SQL of the auth domain, which owns the users and sessions tables. Each
// function runs on q: the pool, or a transaction from db.InTx.

var (
	errUserExists = errors.New("user exists")
	errNoUser     = errors.New("no such user")
)

// findLogin returns the user's id and password hash, and false if there is no such user.
func findLogin(ctx context.Context, q db.DBTX, username string) (core.UserID, string, bool, error) {
	var id core.UserID
	var phc string
	err := q.QueryRow(ctx, `SELECT id, password_hash FROM users WHERE username = $1`, username).Scan(&id, &phc)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", false, nil
	}
	if err != nil {
		return 0, "", false, err
	}
	return id, phc, true, nil
}

func insertSession(ctx context.Context, q db.DBTX, hash []byte, userID core.UserID, lifetime time.Duration, userAgent *string) error {
	_, err := q.Exec(ctx,
		`INSERT INTO sessions (id_hash, user_id, expires_at, user_agent)
		 VALUES ($1, $2, now() + make_interval(secs => $3), $4)`,
		hash, userID, lifetime.Seconds(), userAgent)
	return err
}

// findSession returns the user of a session that is neither past its
// absolute timeout nor idle for longer than idle, or nil. stale is true when
// last_seen_at is older than touchAfter.
func findSession(ctx context.Context, q db.DBTX, hash []byte, idle, touchAfter time.Duration) (*core.CurrentUser, bool, error) {
	var user core.CurrentUser
	var stale bool
	err := q.QueryRow(ctx,
		`SELECT s.user_id, u.username,
		        s.last_seen_at < now() - make_interval(secs => $3) AS stale
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.id_hash = $1
		   AND s.expires_at > now()
		   AND s.last_seen_at > now() - make_interval(secs => $2)`,
		hash, idle.Seconds(), touchAfter.Seconds()).Scan(&user.UserID, &user.Username, &stale)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	user.SessionHash = hash
	return &user, stale, nil
}

func touchSession(ctx context.Context, q db.DBTX, hash []byte) error {
	_, err := q.Exec(ctx, `UPDATE sessions SET last_seen_at = now() WHERE id_hash = $1`, hash)
	return err
}

func deleteSession(ctx context.Context, q db.DBTX, hash []byte) error {
	_, err := q.Exec(ctx, `DELETE FROM sessions WHERE id_hash = $1`, hash)
	return err
}

func deleteUserSessions(ctx context.Context, q db.DBTX, userID core.UserID) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID)
	return tag.RowsAffected(), err
}

func deleteExpiredSessions(ctx context.Context, q db.DBTX, idle time.Duration) (int64, error) {
	tag, err := q.Exec(ctx,
		`DELETE FROM sessions
		 WHERE expires_at <= now() OR last_seen_at <= now() - make_interval(secs => $1)`,
		idle.Seconds())
	return tag.RowsAffected(), err
}

// insertUser returns errUserExists if the name is taken.
func insertUser(ctx context.Context, q db.DBTX, username, phc string) error {
	_, err := q.Exec(ctx, `INSERT INTO users (username, password_hash) VALUES ($1, $2)`, username, phc)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return errUserExists
	}
	return err
}

// updatePassword returns the user's id, or errNoUser.
func updatePassword(ctx context.Context, q db.DBTX, username, phc string) (core.UserID, error) {
	var id core.UserID
	err := q.QueryRow(ctx,
		`UPDATE users SET password_hash = $2, password_changed_at = now()
		 WHERE username = $1 RETURNING id`, username, phc).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, errNoUser
	}
	return id, err
}

// deleteUser deletes the user and (by the foreign key) all their sessions, or returns errNoUser.
func deleteUser(ctx context.Context, q db.DBTX, username string) error {
	tag, err := q.Exec(ctx, `DELETE FROM users WHERE username = $1`, username)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNoUser
	}
	return nil
}
