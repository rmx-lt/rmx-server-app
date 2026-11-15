package transfer

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/rmx-lt/rmx-server-app/internal/db"
)

// All SQL of the transfer domain, which owns the paths table. Each function
// runs on q: the pool, or a transaction from db.InTx.

// StorePath stores the path file doc under path id id (replacing an earlier
// one). The bytes are kept as they are: they are what the mower downloads, so
// the size and the SHA-256 the server puts in path_start stay true.
// Until jobs exist this is the only way a path gets into the table.
func StorePath(ctx context.Context, q db.DBTX, id string, doc []byte) error {
	if int64(len(doc)) > MaxPathBytes {
		return ErrTooLarge
	}
	_, err := q.Exec(ctx,
		`INSERT INTO paths (id, doc) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, created_at = now()`, id, doc)
	return err
}

// getPath returns the stored file of path id; its hash is the one the table computed.
func getPath(ctx context.Context, q db.DBTX, id string) ([]byte, [32]byte, error) {
	var doc, sum []byte
	err := q.QueryRow(ctx, `SELECT doc, sha256 FROM paths WHERE id = $1`, id).Scan(&doc, &sum)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, [32]byte{}, ErrNotFound
	}
	var out [32]byte
	copy(out[:], sum)
	return doc, out, err
}
