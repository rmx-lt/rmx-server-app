// rmx-server: the backend for the browser app and the mower's devices.
// Login and sessions, a WebSocket for the browser, and firmware images for
// devices over MQTT.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"

	"github.com/rmx-lt/rmx-server-app/internal/auth"
	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/db"
	"github.com/rmx-lt/rmx-server-app/internal/server"
)

const usage = `usage:
  rmx-server                      run the server (settings from the environment)
  rmx-server healthcheck          exit 0 if GET /app/health answers 200
  rmx-server create-user <name>   add a login; the password is read from stdin
  rmx-server set-password <name>  new password from stdin; logs the user out everywhere
  rmx-server delete-user <name>   remove a login and all its sessions

The user commands need only DATABASE_URL. On the VPS, for example:
  docker compose exec -T app /app/rmx-server create-user admin < password-file
On a terminal the password is asked twice and not shown.`

func main() {
	// Local development: read .env if there is one. In a container all
	// settings come from the environment and there is no .env file.
	config.LoadDotenv(".env")

	args := os.Args[1:]
	switch {
	case len(args) == 0:
		os.Exit(runServer())
	// For the Docker HEALTHCHECK, since the runtime image has no shell or curl.
	case len(args) == 1 && args[0] == "healthcheck":
		os.Exit(healthcheck())
	case len(args) == 2 && (args[0] == "create-user" || args[0] == "set-password" || args[0] == "delete-user"):
		os.Exit(userCommand(args[0], args[1]))
	case len(args) == 1 && (args[0] == "help" || args[0] == "--help" || args[0] == "-h"):
		fmt.Fprintln(os.Stderr, usage)
	default:
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
}

func setupLogging() {
	var level slog.Level
	if err := level.UnmarshalText([]byte(os.Getenv("LOG_LEVEL"))); err != nil {
		level = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})))
}

func runServer() int {
	setupLogging()
	cfg, err := config.FromEnv()
	if err != nil {
		slog.Error("invalid settings", "error", err)
		return 1
	}
	ln, err := net.Listen("tcp", cfg.BindAddr)
	if err != nil {
		slog.Error("cannot listen", "error", err)
		return 1
	}
	// Ctrl+C, or SIGTERM (what `docker stop` sends).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		slog.Info("shutdown requested")
	}()
	if err := server.Run(ctx, cfg, ln); err != nil {
		slog.Error(err.Error())
		return 1
	}
	return 0
}

// userCommand runs create-user, set-password and delete-user: there is no
// sign-up page, so logins are managed here, on the server, by whoever can run
// commands in the container. The password comes from stdin, never from the
// command line (which would end up in the shell history and the process list).
func userCommand(cmd, name string) int {
	err := func() error {
		password := ""
		if cmd != "delete-user" {
			var err error
			if password, err = readNewPassword(); err != nil {
				return err
			}
		}
		databaseURL := os.Getenv("DATABASE_URL")
		if databaseURL == "" {
			return errors.New("DATABASE_URL is not set")
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		// Migrations run here too, so the tables exist.
		pool, err := db.Connect(ctx, databaseURL, 1)
		if err != nil {
			return err
		}
		defer pool.Close()
		if err := db.Migrate(ctx, pool); err != nil {
			return err
		}
		switch cmd {
		case "create-user":
			return auth.CreateUser(ctx, pool, name, password)
		case "set-password":
			return auth.SetPassword(ctx, pool, name, password)
		default:
			return auth.DeleteUser(ctx, pool, name)
		}
	}()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s %s: %v\n", cmd, name, err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "%s %s: done\n", cmd, name)
	return 0
}

// readNewPassword asks twice without echo on a terminal. Otherwise it reads
// the first line of stdin.
func readNewPassword() (string, error) {
	var password string
	if fd := int(os.Stdin.Fd()); term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "New password: ")
		first, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		fmt.Fprint(os.Stderr, "Again: ")
		again, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		if string(first) != string(again) {
			return "", errors.New("the passwords don't match")
		}
		password = string(first)
	} else {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return "", errors.New("no password on stdin")
		}
		password = strings.TrimRight(line, "\r\n")
	}
	if err := auth.CheckPassword(password); err != nil {
		return "", err
	}
	return password, nil
}

// healthcheck does GET /app/health on our own port; the exit code is 0 only on HTTP 200.
func healthcheck() int {
	port := uint16(8080)
	if addr, err := netip.ParseAddrPort(os.Getenv("BIND_ADDR")); err == nil {
		port = addr.Port()
	}
	client := http.Client{Timeout: 3 * time.Second}
	res, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/app/health", port))
	if err != nil {
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
