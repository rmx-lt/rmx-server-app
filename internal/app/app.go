// Package app is the composition root: it constructs the platform pieces
// and the domains, wires them together (routes, WebSocket ops, MQTT
// suffixes), and starts and stops it all. It also serves health and the
// built web app, and runs the command line (cli.go). Only app (and the
// integration tests) may import every package.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/auth"
	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/db"
	"github.com/rmx-lt/rmx-server-app/internal/mower"
	"github.com/rmx-lt/rmx-server-app/internal/mqtt"
	"github.com/rmx-lt/rmx-server-app/internal/planning"
	"github.com/rmx-lt/rmx-server-app/internal/transfer"
	"github.com/rmx-lt/rmx-server-app/internal/ws"
)

// app is shared by the request handlers.
type app struct {
	cfg  *config.Config
	pool *db.Pool
	auth *auth.Service
	// planning holds the users' maps and settings.
	planning *planning.Service
	// mower holds the devices, their state, catalogues and telemetry.
	mower *mower.Service
	mqtt  *mqtt.Client
	ws    *ws.Server
	// static serves the built web app; nil when STATIC_DIR is not set.
	static http.Handler
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
func Serve(ctx context.Context, cfg *config.Config, pool *db.Pool, ln net.Listener) error {
	defer pool.Close()
	files, err := transfer.Open(transfer.Config{FirmwareDir: cfg.FirmwareDir, PathFileDir: cfg.PathFileDir})
	if err != nil {
		return err
	}
	defer files.Close()

	authSvc := auth.New(pool)
	sockets := ws.New(ctx, authSvc.SessionValid)
	mowerSvc := mower.New(pool, sockets)
	mower.RegisterWS(sockets, mowerSvc)
	mq := mqtt.New(cfg.MQTT)
	transfer.RegisterMQTT(mq, files)
	mower.Register(mq, mowerSvc)
	mowerSvc.Connect(mq)
	mowerSvc.SetNTRIP(cfg.NTRIP, cfg.MQTT.Password)
	static, closeStatic := openStatic(cfg.StaticDir)
	defer closeStatic()

	mq.Start()
	a := &app{cfg: cfg, pool: pool, auth: authSvc, planning: planning.New(pool), mower: mowerSvc, mqtt: mq, ws: sockets, static: static}

	var background sync.WaitGroup
	background.Add(2)
	go func() {
		defer background.Done()
		authSvc.DeleteExpiredHourly(ctx)
	}()
	go func() {
		defer background.Done()
		mowerSvc.Run(ctx)
	}()

	srv := &http.Server{
		Handler:           a.handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
	}
	failed := make(chan error, 1)
	go func() { failed <- srv.Serve(ln) }()
	slog.Info("listening", "addr", ln.Addr().String())

	select {
	case err := <-failed:
		mq.Stop()
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
	a.ws.Wait()
	slog.Debug("sockets closed")
	// HTTP is drained; let MQTT say goodbye, then close the pool.
	mq.Stop()
	background.Wait()
	slog.Info("stopped")
	return nil
}
