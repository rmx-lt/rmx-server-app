package main

import (
	"io"
	"log/slog"
	"os"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/config"
)

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	config.LoadDotenv("../../.env") // the integration test needs the broker settings
	os.Exit(m.Run())
}
