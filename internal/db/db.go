// Package db connects to the database, applies the schema migrations, and
// gives the domains' stores one interface for "the pool or a transaction"
// (DBTX), plus InTx. Together with the domains' store.go files it is the only
// code that imports pgx.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/rmx-lt/rmx-server-app/migrations"
)

// Pool is the connection pool. The alias lets the app hold it without importing pgx.
type Pool = pgxpool.Pool

// DBTX is what a store runs its queries on: the pool, or a transaction from
// InTx. A cross-domain write passes the same transaction to both stores.
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

var (
	_ DBTX = (*pgxpool.Pool)(nil)
	_ DBTX = (pgx.Tx)(nil)
)

// InTx runs fn in a transaction: committed when fn returns nil, else rolled
// back. Publish events only after InTx has returned nil.
func InTx(ctx context.Context, pool *Pool, fn func(tx DBTX) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Ping checks that the database answers a query.
func Ping(ctx context.Context, q DBTX) error {
	var one int
	return q.QueryRow(ctx, "SELECT 1").Scan(&one)
}

// Connect opens a connection pool and checks that the database answers.
func Connect(ctx context.Context, url string, maxConns int32) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}
	cfg.MaxConns = maxConns
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("cannot connect to the database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("cannot connect to the database: %w", err)
	}
	return pool, nil
}

// Migrate applies the pending migrations.
//
// The earlier Rust version of this server applied the same files with sqlx and recorded
// them in _sqlx_migrations. A database that has that table but no goose table
// yet is adopted first: its versions are copied over, so nothing runs twice.
// The old table stays, which keeps a rollback to the Rust image possible.
func Migrate(ctx context.Context, pool *Pool) error {
	conn := stdlib.OpenDBFromPool(pool)
	defer conn.Close()

	if err := adoptSqlx(ctx, conn); err != nil {
		return fmt.Errorf("database migration failed: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, conn, migrations.FS)
	if err != nil {
		return fmt.Errorf("database migration failed: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("database migration failed: %w", err)
	}
	return nil
}

// adoptSqlx records the migrations sqlx already applied as applied in goose's table.
func adoptSqlx(ctx context.Context, conn *sql.DB) error {
	var adopt bool
	err := conn.QueryRowContext(ctx,
		`SELECT to_regclass('_sqlx_migrations') IS NOT NULL AND to_regclass('goose_db_version') IS NULL`,
	).Scan(&adopt)
	if err != nil || !adopt {
		return err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// The table as goose creates it, and its version 0 row.
	for _, stmt := range []string{
		`CREATE TABLE goose_db_version (
			id serial NOT NULL PRIMARY KEY,
			version_id bigint NOT NULL,
			is_applied boolean NOT NULL,
			tstamp timestamp NOT NULL DEFAULT now()
		)`,
		`INSERT INTO goose_db_version (version_id, is_applied) VALUES (0, true)`,
		`INSERT INTO goose_db_version (version_id, is_applied)
		 SELECT version, true FROM _sqlx_migrations WHERE success ORDER BY version`,
	} {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return tx.Commit()
}
