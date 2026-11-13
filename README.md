# rmx-server-app

The backend and web app of **Blade of Grass**, an open-source robotic lawn mower
(Go backend, React frontend). Today it serves login and sessions, a
WebSocket for the browser, firmware images to the mower's devices over
MQTT, and the web app: the planning workbench ported from
[blade-terminal](https://github.com/jRmx0/blade-terminal) (environments are
stored in the browser for now); the mower features build on that.

The stack: a Go server (`net/http`, pgx, goose,
paho.golang, coder/websocket), a TypeScript + React web app (`web/`) on Bun's
bundler, TimescaleDB, Mosquitto, GitHub Actions, images on GHCR. The TypeScript
types in `web/src/data/api/generated` are generated from the Go types in
`internal/api`.

- **Docs:** [Server-App](https://github.com/rmx-lt/blade-of-grass/wiki/Server-App)
  on the wiki: how it works, wire protocol, login and sessions, the repository
  layout and its import rules, tests, CI/CD and the deployment contract. The page lives in this repo's `wiki/` folder and
  changes by pull request; rules: [Wiki-Policy](https://github.com/rmx-lt/blade-of-grass/blob/development/wiki/Wiki-Policy.md).
- **Work:** issues on the [Blade of Grass project](https://github.com/orgs/rmx-lt/projects/1).

## Local development

You need Docker Desktop, Go (the version in `go.mod`), and Bun. No Node or npm.

```powershell
# 1. Settings (dev-only passwords), then TimescaleDB + Mosquitto.
Copy-Item .env.example .env
docker compose -f compose.dev.yaml up -d --wait

# 2. The server (runs migrations, listens on 127.0.0.1:8080).
go run ./cmd/rmx-server

# 3. The web dev server, in a second terminal.
cd web
bun install
bun run dev
```

Create a login once (`go run ./cmd/rmx-server create-user dev`, any
password of 12+ characters), then open <http://localhost:3000/app/> and log in; the workbench loads. Ports, MQTT testing and
the checks CI runs: see the wiki page Server-App.

Checks before a pull request:

```powershell
gofmt -l .                                      # prints nothing when formatted
go vet ./...
go tool staticcheck ./...
go test -race ./...                             # unit tests, import rules, public-route allow-list
go test -tags integration -count=1 ./...        # needs the compose stack and .env
go run ./cmd/gen-ts                             # regenerate web/src/data/api/generated; commit the result
cd web; bun run check                           # lint (incl. layer boundaries), types, tests, build
```

The migrations in `migrations/` run when the server starts. A database that the
earlier Rust version migrated (with sqlx) is adopted on the first start.

## License

Code and documentation are licensed under [Apache-2.0](LICENSE).
