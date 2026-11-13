// Package server wires the probe together: the HTTP routes (login, health,
// the built client), the WebSocket, the MQTT client (firmware for devices,
// the server's status), and the start and stop of it all.
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rmx-lt/rmx-backend-probe/internal/auth"
	"github.com/rmx-lt/rmx-backend-probe/internal/config"
	"github.com/rmx-lt/rmx-backend-probe/internal/db"
	"github.com/rmx-lt/rmx-backend-probe/internal/firmware"
)

// Version is reported by /probe/health. The release build sets it with -ldflags.
var Version = "0.1.0"

// Server is shared by all request handlers.
type Server struct {
	cfg  *config.Config
	pool *pgxpool.Pool
	auth *auth.Service
	mqtt *mqttClient

	// ctx ends when the server is asked to stop; WebSockets close then.
	ctx context.Context
	// sockets counts the open WebSockets: they are hijacked, so http.Server.Shutdown does not wait for them.
	sockets sync.WaitGroup
}

// Run connects to the database (applying pending migrations) and the broker,
// then serves HTTP on ln until ctx is cancelled.
func Run(ctx context.Context, cfg *config.Config, ln net.Listener) error {
	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DBMaxConnections)
	if err != nil {
		return err
	}
	if err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		return err
	}
	slog.Info("database ready")
	return Serve(ctx, cfg, pool, ln)
}

// Serve is like Run, but with an existing, already migrated pool (used by the
// integration tests, which get a fresh database per test). It closes the pool
// when it stops.
func Serve(ctx context.Context, cfg *config.Config, pool *pgxpool.Pool, ln net.Listener) error {
	defer pool.Close()
	fw, err := openFirmware(cfg)
	if err != nil {
		return err
	}
	if fw != nil {
		defer fw.Close()
	}
	mq := startMQTT(cfg.MQTT, fw)
	s := &Server{cfg: cfg, pool: pool, auth: auth.New(pool), mqtt: mq, ctx: ctx}

	var background sync.WaitGroup
	background.Add(1)
	go func() {
		defer background.Done()
		s.deleteExpiredSessions(ctx)
	}()

	srv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
	}
	failed := make(chan error, 1)
	go func() { failed <- srv.Serve(ln) }()
	slog.Info("listening", "addr", ln.Addr().String())

	select {
	case err := <-failed:
		mq.stop()
		return fmt.Errorf("http server failed: %w", err)
	case <-ctx.Done():
	}

	// Stop taking requests; open WebSockets are told to go away.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		slog.Warn("http shutdown", "error", err)
	}
	slog.Debug("sockets draining")
	s.sockets.Wait()
	slog.Debug("sockets closed")
	// HTTP is drained; let MQTT say goodbye, then close the pool.
	mq.stop()
	background.Wait()
	slog.Info("stopped")
	return nil
}

// openFirmware opens FIRMWARE_DIR. An empty path means firmware is off.
func openFirmware(cfg *config.Config) (*firmware.Store, error) {
	if cfg.FirmwareDir == "" {
		slog.Info("firmware directory is not set; firmware requests are not served")
		return nil, nil
	}
	store, err := firmware.Open(cfg.FirmwareDir, cfg.FirmwareChunkBytes)
	if err != nil {
		return nil, err
	}
	slog.Info("firmware directory ready", "dir", cfg.FirmwareDir, "chunk_bytes", cfg.FirmwareChunkBytes)
	return store, nil
}

// deleteExpiredSessions deletes sessions that have timed out, once an hour.
func (s *Server) deleteExpiredSessions(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			n, err := s.auth.DeleteExpired(ctx)
			if err != nil {
				slog.Warn("deleting expired sessions failed", "error", err)
			} else if n > 0 {
				slog.Info("deleted expired sessions", "sessions", n)
			}
		case <-ctx.Done():
			return
		}
	}
}
