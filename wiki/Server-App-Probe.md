# Server-App-Probe (rmx-server-app-probe)

A small learning and diagnostic project for **Blade of Grass**, an open-source
robotic lawn mower. It rehearses the full production workflow of the future
`rmx-server-app` (Go backend, React frontend) on a toy problem:

> A web page with a live table `records(time, connection_type, value)` and full
> CRUD over a selectable transport (**HTTPS REST** or **WSS**), plus the same
> CRUD for devices over **MQTT** (like the LTE modem probe in
> `rmx-mower-gateway-probe`). Every change is logged to a TimescaleDB hypertable
> and pushed live to every open page, whatever transport made it.

The same stack as production: a Go server (`net/http`, pgx, goose, paho.golang,
coder/websocket), a TypeScript + React client on Bun's bundler, TimescaleDB,
Mosquitto, GitHub Actions, images on GHCR. The probe was written in Rust first
and ported to Go in November 2026, when the backend language was decided
(rmx-server-app-probe#24).

## Contents

- [How it works](#how-it-works)
- [Login and sessions](#login-and-sessions)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Tests and checks](#tests-and-checks)
- [CI/CD](#cicd)
- [Deployment](#deployment) (contract for the VPS side)
- [License](#license)

## How it works

```
browser ──HTTPS/WSS :443──▶ Caddy ──▶ probe-server :8080 ──▶ TimescaleDB
          /probe/api, /probe/ws             ▲
                                            │ mqtt:1883 (plain, internal)
device ──MQTT over TLS :8883──────────▶ Mosquitto
```

This is the production layout: **browsers never speak MQTT**. Only devices
(mowers, the modem probe) and the server do, directly with Mosquitto on 8883;
Caddy only renews the certificate Mosquitto uses. Browsers talk to the server
over HTTPS and its WebSocket, with their session.

- **One records service** (`internal/records`) does every
  create/update/delete in a transaction that also appends to `record_events`,
  then broadcasts a `ChangeEvent` in-process (a small hub; a subscriber that falls 256 events behind is dropped, and a WebSocket then closes with 1013 so the page reconnects and lists again).
- **HTTPS**: REST under `/probe/api/records`.
- **WSS**: `/probe/ws`, JSON request/response with a `request_id`, plus
  server-pushed change events.
- **MQTT** (devices): the server subscribes to `probe/req/+` and answers on
  `probe/res/<client-id>`; change events go to `probe/events/records`.
- **Login**: the app's own login page and server-side sessions in a cookie
  protect the API and the WebSocket (see
  [Login and sessions](#login-and-sessions)).
- **Live updates**: every change goes to every WebSocket and to the MQTT
  events topic, so the page sees a device's changes live (over WSS), and
  devices see the page's.

### Database

Migrations: `migrations/` (goose, embedded in the binary, run at server start).
A database the earlier Rust version migrated with sqlx is adopted on the first
start: its versions are copied from `_sqlx_migrations` into goose's table, which
stays, so nothing runs twice.

| Table | Kind | Columns |
|---|---|---|
| `records` | plain table (rows change in place) | `id`, `time` (created), `connection_type` (`https`/`wss`/`mqtt`, who created or last changed it), `value` (nullable), `updated_at`, `created_ip` (`inet`, who created it) |
| `record_events` | hypertable, 1-day chunks | `time`, `connection_type`, `op` (`create`/`update`/`delete`), `record_id`, `value`, `ip` (`inet`, who made this change) |
| `users` | plain table | `id`, `username` (lower case, unique), `password_hash` (Argon2id PHC string), `created_at`, `password_changed_at` |
| `sessions` | plain table | `id_hash` (SHA-256 of the cookie token), `user_id` (→ users, cascade), `created_at`, `last_seen_at`, `expires_at`, `user_agent` |

`record_events` is compressed after 1 day and dropped after 7 days
(TimescaleDB background jobs). It has no foreign key, so deleted records keep
their history.

**Client IPs.** Every change stores the client's IP: `records.created_ip` for
whoever created the row (an update keeps it; the UI shows it as "Created by
IP"), and `record_events.ip` for each create, update and delete. Over
HTTPS it's the request's IP, over WSS the IP of the WebSocket handshake.
Behind Caddy that is the last `X-Forwarded-For` entry, the address Caddy saw;
locally it's the TCP peer. Over MQTT it is `NULL` ("unknown" in the UI): the
request reaches the server through the broker, which doesn't pass on the
client's address. IP addresses are personal data. Only logged-in users see
them, and the event log drops them with its chunks after 7 days, but
`records` keeps `created_ip` as long as the row exists.

### Wire protocol

All types are defined once in Go (`internal/protocol`) and generated for
TypeScript by `cmd/gen-ts` into `client/src/generated/`, one file per type.

**Why generated, and why committed:** the Go types are the single source of
truth. Structs and enums are read by reflection and the doc comments from the
source; unions (`Request`, `RpcResult`, `RpcData`, `ChangeEvent`,
`ServerMessage`) come from the table in `internal/protocol/union.go`, which also
drives the JSON codec, so the two cannot drift apart. The generated files are
committed so the client builds without a Go toolchain (the Bun stage in the
Dockerfile, the client CI job). CI regenerates them and fails if the committed
copy is stale. After changing a type: `go run ./cmd/gen-ts`, then commit the
changed files.

REST:

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/probe/api/records` | | `RecordRow[]` (newest 500) |
| POST | `/probe/api/records` | `{"value": string \| null}` | 201 `RecordRow` |
| PUT | `/probe/api/records/{id}` | `{"value": string \| null}` | 200 `RecordRow` / 404 |
| DELETE | `/probe/api/records/{id}` | | 204 / 404 |
| POST | `/probe/api/auth/login` | `{"username", "password"}` | 200 `{"username"}` + `Set-Cookie` / 401 / 429 + `Retry-After` |
| GET | `/probe/api/auth/me` | | 200 `{"username"}` / 401 |
| POST | `/probe/api/auth/logout` | | 204, clears the cookie (also without a session) |
| POST | `/probe/api/auth/logout-all` | | 204: ends every session of the user |

Everything except login, logout and `/probe/health` needs the session cookie
(else 401). Every request that changes something, and the WebSocket handshake,
needs an allowed `Origin` (else 403).

Errors: `{"code": "bad_request" | "not_found" | "internal" | "unauthorized" | "forbidden" | "too_many_requests", "message": "..."}`.
`value` is at most 1000 characters.

WSS and MQTT share one envelope:

```jsonc
// client → server
{ "request_id": "uuid", "request": { "op": "list" } }
{ "request_id": "uuid", "request": { "op": "create", "value": "hi" } }
{ "request_id": "uuid", "request": { "op": "update", "id": 7, "value": null } }
{ "request_id": "uuid", "request": { "op": "delete", "id": 7 } }

// server → client (MQTT: this object; WSS: wrapped as {"type":"response","response":{...}})
{ "request_id": "uuid", "result": { "status": "ok", "data": { "kind": "record", "record": { ... } } } }
{ "request_id": "uuid", "result": { "status": "error", "error": { "code": "not_found", "message": "..." } } }

// change event (MQTT events topic: this object; WSS: {"type":"event","event":{...}})
{ "op": "create", "record": { ... } }
{ "op": "delete", "id": 7, "connection_type": "mqtt" }
```

MQTT topics (`<prefix>` is `probe`):

| Topic | Direction | Payload |
|---|---|---|
| `<prefix>/req/<client-id>` | client → server | request envelope |
| `<prefix>/res/<client-id>` | server → client | response envelope |
| `<prefix>/events/records` | server → all | change event |
| `<prefix>/status/server` | server → all, **retained** | `online` / `offline` (last will) |

The client id travels in the topic (like the planned `mower/<id>/cmd`), not in
MQTT 5 properties, so the scheme works on MQTT 3.1.1 and on small device
clients, and a broker ACL can scope each login to its own topics. The server
answers only on `<prefix>/res/<id>` for the id it got the request on.

## Login and sessions

The probe rehearses how production (`rmx-server-app`) should log
people in. Code: `internal/auth/` and
`client/src/components/LoginForm.tsx`.

```
browser                                   probe-server                     TimescaleDB
  │ POST /probe/api/auth/login {user,pw}     │                                 │
  │ ───────────────────────────────────────▶ │ Argon2id check (slow, 19 MiB)   │
  │                                          │ token = 32 random bytes         │
  │                                          │ INSERT sessions(sha256(token))  │──▶
  │ ◀── Set-Cookie: __Secure-probe_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/probe
  │                                          │                                 │
  │ GET /probe/api/records  (the browser adds the cookie)                      │
  │ GET /probe/ws + Upgrade (the cookie too) │ look up sha256(cookie):         │
  │ ───────────────────────────────────────▶ │ exists, not idle, not expired?  │──▶
  │ ◀── 200 / 101 Switching Protocols, or 401                                  │
  │ POST /probe/api/auth/logout              │ DELETE the row                  │──▶
```

**Why a session cookie, and not basic auth or a token in JavaScript**

- *Basic auth* (what Caddy did before): the browser sends the password itself
  with every request, there is no real logout, and iOS WebKit doesn't send it
  on WebSocket handshakes (the probe's WSS failed on iPhones). Browsers do
  send cookies on WebSocket handshakes, so checking the cookie there fixes it.
- *A token kept by JavaScript* (localStorage, `Authorization: Bearer`, often a
  JWT): any script that runs on the page (an XSS bug, a compromised npm
  package) can read it and use it elsewhere. An `HttpOnly` cookie can't be
  read by scripts at all. Browsers also can't set headers on WebSocket
  handshakes, so such tokens end up in URLs, which get logged.
- *A row in the database* can be revoked at once: logout, "log out
  everywhere", a password change. A signed stateless token (JWT) stays valid
  until it expires.

**The choices, one by one**

| What | Choice | Why |
|---|---|---|
| Password hash | Argon2id (m = 19 MiB, t = 2, p = 1), random salt | OWASP's recommendation. Slow and memory-hard, so stolen hashes are expensive to crack. The PHC string stores its parameters, so they can be raised later. One check at a time, because probe-app has a 64 MB memory limit. |
| Password rules | 12–256 characters, nothing else | NIST SP 800-63B: length matters, composition rules don't. |
| Session id | 32 bytes from the OS random generator (64 hex characters) | 256 bits can't be guessed. |
| Stored as | SHA-256 of the token | A leaked database dump has no working sessions. A fast hash is fine because the token is random (passwords need the slow one). |
| Timeouts | idle 7 days (sliding), absolute 30 days | Stay logged in on your own phone, but nothing lives forever. `last_seen_at` is written at most once a minute. Timed-out rows are deleted every hour. |
| Logout | deletes the row, clears the cookie | The cookie is worthless afterwards, even if someone copied it. "Log out everywhere" and `set-password` delete all rows of the user. Open WebSockets re-check their session with every ping (30 s) and are closed with code 4001. |
| New session id at every login | yes | Prevents session fixation. |
| `HttpOnly` | yes | Scripts can't read the cookie. |
| `Secure` | yes | HTTPS only. (Browsers treat `http://localhost` as secure, so local development works.) |
| `SameSite` | **Strict** | The cookie is never sent on requests that another site starts, so a foreign page can't use it (CSRF). Lax would also send it when someone follows a link here from another site; we don't need that, because the page (static files) is public and only its own same-site API calls need the cookie. |
| `Path` | `/probe` | The probe shares `api.rmx.lt` with the future production backend; its cookie stays under `/probe`. |
| Prefix | `__Secure-`, not `__Host-` | `__Host-` would be stronger (it also forbids `Domain=`, so a sibling like `rmx.lt` couldn't plant a cookie with the same name), but it requires `Path=/`. If a request carries our cookie name twice, the server treats it as logged out rather than guess which one is real. **Production** should own a whole origin and use `__Host-session; Path=/`. |
| CSRF | SameSite **plus** an `Origin` check | SameSite works per *site* (all of `rmx.lt`), and not every browser enforces it. Every request that isn't GET/HEAD/OPTIONS, and every WebSocket handshake, must have an `Origin` from `ALLOWED_ORIGINS`, or it gets 403. The login too (no "log the victim into the attacker's account"). WebSockets matter most: CORS doesn't cover them, so without this any website could open one with the user's cookie ("cross-site WebSocket hijacking"). |
| Password guessing | in-memory backoff per username and per IP | 5 free failures per username (20 per IP), then 1 s, 2 s, 4 s … up to 15 min; while waiting, even the right password gets 429. Unknown usernames are checked against a dummy hash, so they take as long and get the same answer. A restart forgets the counters; several instances would need a shared store. |
| Client IP | last `X-Forwarded-For` entry, else the TCP peer | Caddy sets that header; the app's port is not published, so only Caddy reaches it. |
| Caching | `Cache-Control: no-store` behind the login | No copy of user data in a shared cache, or in the back button after logout. |

**What's public:** `/probe/health` (only up/down and the version, for the
deploy script and monitoring), login and logout, and the client's static files
(the same code as in this repository, no data). All other routes are in the
router's `protected` group (`internal/server/routes.go`), which requires
a session, so a new route is protected unless someone deliberately puts it in
the public group.

**MQTT is for devices only.** Browsers don't talk to Mosquitto: they go
through the server's WebSocket with their session, so there is one login for
people and one place that checks it. Devices have their own broker logins
(e.g. `probe-device` on the VPS), limited by the broker's ACL to their own
topics. (Until 2026-10-20 the page also spoke MQTT over WebSockets as
`probe-web`; that was removed to match production.)

### Users

There is no sign-up page. Users are managed with subcommands of the server
binary, which need only `DATABASE_URL` and run the migrations first. The
password is read from **stdin** (on a terminal: asked twice, not shown), never
from the command line, which would end up in the shell history and the
process list.

```powershell
# Local development (DATABASE_URL comes from .env):
go run ./cmd/probe-server create-user alice      # asks for the password
go run ./cmd/probe-server set-password alice     # new password, ends all sessions
go run ./cmd/probe-server delete-user alice      # also deletes the sessions
```

On the VPS, inside the running container (distroless: no shell, so the
password is piped in from the host):

```bash
docker compose exec -T probe-app /app/probe-server create-user probe < password-file
```

Usernames: 1–32 characters `a-z 0-9 . _ -`, case-insensitive. Passwords:
12–256 characters. There is no default user and no default password.

## Repository layout

```
go.mod, go.sum                    Go module (go 1.26), staticcheck pinned as a tool
cmd/probe-server/                 main: server, healthcheck, user commands
cmd/gen-ts/                       TypeScript type generator
internal/protocol/                wire types, union codec, MQTT topic helpers
internal/{config,apperr,clientip,db}/  settings, errors, client IP, connection + migrations
internal/auth/                    passwords, sessions, rate limit, login routes, Origin check
internal/records/                 records service and the event hub
internal/server/                  routes, ws, mqtt, start/stop; integration_test.go
migrations/                       goose SQL migrations (embedded)
client/                           React 19 + TS on Bun (same toolchain as blade-terminal)
  public/index.html               HTML entry (Bun HTML import)
  server/index.ts                 dev server: HMR + proxy to probe-server
  scripts/build.ts                production build → dist/
  src/generated/                  generated by cmd/gen-ts (do not edit)
compose.dev.yaml, dev/mosquitto/  local/CI stack: TimescaleDB + Mosquitto
Dockerfile                        multi-stage: bun build + go build → distroless/static
.github/                          CI workflow, Dependabot
```

## Local development

You need Docker Desktop, Go (the version in `go.mod`), and Bun. No Node or npm.

```powershell
# 1. Settings: dev-only passwords for the local stack.
Copy-Item .env.example .env

# 2. TimescaleDB + Mosquitto (localhost only).
docker compose -f compose.dev.yaml up -d --wait

# 3. The server (reads .env, runs migrations, listens on 127.0.0.1:8080).
go run ./cmd/probe-server

# 4. The client dev server, in a second terminal.
cd client
bun install
bun run dev
```

Create a login once (the dev database keeps it), then open
<http://localhost:3000/probe/> and log in:

```powershell
go run ./cmd/probe-server create-user dev     # any password of 12+ characters
```

To try MQTT like a device, use any MQTT client on `127.0.0.1:11883` as
`probe-device` with the `PROBE_DEVICE_PASSWORD` from `.env`
(`probe-device-dev`), publishing to `probe/req/<client-id>`.

Local ports (chosen so they don't clash with a Postgres or Mosquitto
installed on the PC):

| Port | What |
|---|---|
| 3000 | Bun dev server (client with hot reload) |
| 8080 | probe-server |
| 55432 | TimescaleDB (`postgres://probe:probe-dev@127.0.0.1:55432/probe`) |
| 11883 | Mosquitto, plain MQTT (the server and test devices) |

**How the dev server works.** `bun run dev` runs `client/server/index.ts`:
`Bun.serve` with an HTML import of `public/index.html`, so Bun bundles the app
on the fly with hot module reloading and Tailwind (`bun-plugin-tailwind` in
`bunfig.toml`). The same server proxies `/probe/api/*`, `/probe/health`,
and the `/probe/ws` WebSocket to probe-server (passing
on the session cookie and `Origin`, which probe-server checks)
(`PROBE_BACKEND_URL`, default `http://127.0.0.1:8080`). The browser sees a
single origin with the same paths as production, so there is no CORS and no
environment-specific URL in the client code.

Stop the stack with `docker compose -f compose.dev.yaml down` (add `-v` to
also delete the database volume).

Run the production image against the dev stack:

```powershell
docker build -t rmx-backend-probe:local .
docker run --rm -p 8080:8080 `
  -e DATABASE_URL=postgres://probe:probe-dev@host.docker.internal:55432/probe `
  -e MQTT_HOST=host.docker.internal -e MQTT_PORT=11883 `
  -e MQTT_USERNAME=probe-app -e MQTT_PASSWORD=probe-app-dev `
  -e ALLOWED_ORIGINS=http://localhost:8080 `
  rmx-backend-probe:local
```

Then open <http://localhost:8080/probe/>.

## Tests and checks

| What | Command |
|---|---|
| Format | `gofmt -l .` (prints nothing when formatted) |
| Lint | `go vet ./...` and `go tool staticcheck ./...` |
| Unit tests | `go test -race ./...` |
| Integration tests (needs the compose stack and `.env`) | `go test -tags integration -count=1 ./...` |
| Regenerate TS types | `go run ./cmd/gen-ts` |
| Client lint / types / tests / build | `cd client; bun run lint; bun run typecheck; bun test; bun run build` |

The integration tests (`internal/server/integration_test.go`) start the real
server on a random port; each test creates a fresh migrated database, and uses
its own MQTT topic prefix, so they run in parallel. They cover REST, WSS and MQTT CRUD,
cross-transport live events, health, the `record_events` log,
the retained server status and graceful shutdown, and the login: wrong
password and unknown user, protected routes (REST, WebSocket)
without, with a forged and with a duplicated cookie, expired and idle
sessions, logout and "log out everywhere", password change, session
fixation, foreign `Origin`s (REST, login, WebSocket) and the rate limit.

**Queries** are plain SQL strings checked at run time by the integration tests,
so after changing one, run them.

## CI/CD

`.github/workflows/ci.yml`, on every pull request and push:

1. **go**: gofmt, `go vet`, staticcheck, `go test -race`, TS types up to date.
2. **client**: `bun install --frozen-lockfile`, eslint, tsc, `bun test`, build.
3. **integration**: `compose.dev.yaml` up, integration tests.
4. **image**: after 1–3 pass, builds the Docker image (cached in the GitHub
   Actions cache). On pull requests and `development` it is only built. On
   `production` it is pushed as `sha-<short>` and `production`; on a `v*` tag
   as `X.Y.Z` and `X.Y`.
5. **deploy**: only on `production`, sends the new tag to the VPS (see below).

Dependabot (`.github/dependabot.yml`) opens weekly updates for Go modules, the
client (npm ecosystem: `package.json` + `bun.lock`), GitHub Actions and the
Dockerfile's base images.

## Deployment

This is the contract the VPS side (repo `rmx-server-infra`) can rely on.

**Image:** `ghcr.io/rmx-lt/rmx-backend-probe`, public, linux/amd64.

| Tag | Meaning |
|---|---|
| `sha-<short>` | every push to `production` (deploy this one: immutable) |
| `production` | latest `production` |
| `X.Y.Z`, `X.Y` | release tags `vX.Y.Z` |

**Container:**

- Listens on **`0.0.0.0:8080`** (HTTP; TLS is Caddy's job). Publish no port;
  Caddy reaches it over the Docker network.
- Runs as uid **65532** (distroless `nonroot`), no shell. Needs no volumes.
- `HEALTHCHECK` built in (`/app/probe-server healthcheck` → `GET /probe/health`).
- Stops cleanly on SIGTERM (closes WebSockets, publishes MQTT `offline`).
- Memory: about 15 MB at idle; a login briefly needs ~20 MB more (Argon2, one at
  a time). `mem_limit: 64m` is enough: the image sets `GOMEMLIMIT=40MiB` so the
  Go garbage collector gives memory back early (measured about 35 MiB with 30
  parallel logins).
- Networks: `backend` (database) and `edge` (Mosquitto, Caddy).

**Environment:**

| Variable | Required | Example (VPS) | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | `postgres://probe:…@probe-db:5432/probe` | migrations run at start. No TLS (internal network). |
| `MQTT_HOST` | yes | `mosquitto` | plain MQTT on the internal network |
| `MQTT_PORT` | no | `1883` | default 1883 |
| `MQTT_USERNAME` | yes | `probe-app` | ACL: `probe/#` |
| `MQTT_PASSWORD` | yes | (secret, server-side `.env`) | never logged |
| `ALLOWED_ORIGINS` | **yes** | `https://api.rmx.lt` | comma-separated origins of the page. Others can't log in, change data or open the WebSocket (403). The server doesn't start without it |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error`. The Rust version's `RUST_LOG` is ignored |
| `BIND_ADDR` | no | `0.0.0.0:8080` | already set in the image |
| `MQTT_CLIENT_ID` | no | `probe-server` | must be unique on the broker |
| `MQTT_TOPIC_PREFIX` | no | `probe` | |
| `DB_MAX_CONNECTIONS` | no | `5` | |
| `STATIC_DIR` | no | `/app/static` | already set in the image |

**Database:** TimescaleDB on Postgres 17 (`timescale/timescaledb:2.30.2-pg17`
or newer 2.x). The first migration runs `CREATE EXTENSION IF NOT EXISTS
timescaledb`, so the database user must own the database and either be a
superuser (the image's `POSTGRES_USER` is) or the extension must already exist.

**Routes the app serves itself** (Caddy proxies `api.rmx.lt/probe/*` as-is and
must **not** strip the `/probe` prefix). The app does its own login, so Caddy
needs no `basic_auth` in front of it:

| Path | Login | What |
|---|---|---|
| `/probe` | public | 308 redirect to `/probe/` |
| `/probe/` and other unknown `/probe/*` | public | the client (static files, `index.html` fallback); it shows the login form |
| `/probe/api/auth/login`, `/probe/api/auth/logout` | public | login, logout |
| `/probe/health` | public | `{"status":"ok","db":true,"mqtt":true,"version":"0.1.0"}`, 200 or 503 |
| `/probe/api/records[/{id}]`, `/probe/api/auth/me`, `/probe/api/auth/logout-all` | session | REST |
| `/probe/ws` | session | WebSocket (Caddy proxies upgrades by default) |

**Proxy requirements:** pass on `Host`, `Origin` and `Cookie` unchanged (Caddy
does by default) and set `X-Forwarded-For` (Caddy does; the login rate limit
uses it). **First user:** see [Users](#users).

**MQTT devices** connect to the broker's public TLS listener (VPS:
`mqtts://mqtt.rmx.lt:8883`, `use_username_as_clientid`), so a device's client
id is its login, e.g. `probe-device`. Its ACL needs: write
`probe/req/<login>`, read `probe/res/<login>`, `probe/events/#`,
`probe/status/#`. The broker needs no WebSocket listener and Caddy no MQTT
route: browsers don't use MQTT. `MQTT_WS_URL` and `/probe/config.json` were
removed (an old `MQTT_WS_URL` in the environment is ignored).

**Deploy job:** every push to `production` deploys automatically (`feat/…` → PR → `development` → PR → `production`). After the `image`
job, the `deploy` job in `ci.yml` connects over SSH as the VPS user `deploy`
and sends only the tag `sha-<short>`. That user's key is restricted to one
forced command, the script `rmx-deploy-probe` (source:
[rmx-server-infra `services/probe/deploy/`](https://github.com/rmx-lt/rmx-server-infra/tree/development/services/probe/deploy)).
It checks the tag, pulls the image, restarts `probe-app`, waits for
`/probe/health`, and rolls back to the previous tag if the new one isn't
healthy (the job then fails). If the probe is switched off on the VPS, the
tag is only recorded, not started.

Repository secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (the private key),
`DEPLOY_KNOWN_HOSTS` (the VPS's ed25519 host-key line, pinned). Rotating the
key is described on the wiki page [Server-Infra](Server-Infra#probe-rmx-server-app-probe) (§10, "Probe").

## License

[Apache-2.0](https://github.com/rmx-lt/rmx-server-app-probe/blob/development/LICENSE).
