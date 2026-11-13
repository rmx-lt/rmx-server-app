# Server-App (rmx-server-app)

The backend and web app of **Blade of Grass**, an open-source robotic lawn mower
(Go backend, React frontend). Today it serves login and sessions, a WebSocket
for the browser, and firmware images to the mower's devices over MQTT; the
mower features build on that.

The stack: a Go server (`net/http`, pgx, goose, paho.golang,
coder/websocket), a TypeScript + React client on Bun's bundler, TimescaleDB,
Mosquitto, GitHub Actions, images on GHCR. The server was written in Rust first
and ported to Go in November 2026, when the backend language was decided
(rmx-server-app#24).

## Contents

- [How it works](#how-it-works)
- [Firmware over MQTT](#firmware-over-mqtt)
- [Login and sessions](#login-and-sessions)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Tests and checks](#tests-and-checks)
- [CI/CD](#cicd)
- [Deployment](#deployment) (contract for the VPS side)
- [License](#license)

## How it works

```
browser ──HTTPS/WSS :443──▶ Caddy ──▶ rmx-server :8080 ──▶ TimescaleDB
          /app/api, /app/ws                 ▲
                                            │ mqtt:1883 (plain, internal)
device ──MQTT over TLS :8883──────────▶ Mosquitto
```

This is the production layout: **browsers never speak MQTT**. Only devices
(mowers, the LTE gateway) and the server do, directly with Mosquitto on 8883;
Caddy only renews the certificate Mosquitto uses. Browsers talk to the server
over HTTPS and its WebSocket, with their session.

- **HTTPS**: login and logout under `/app/api/auth`, `/app/health`, and
  the built client under `/app/`.
- **WSS**: `/app/ws`, JSON request/response with a `request_id`. The only
  request today is `ping`; the connection (session check, keep-alive, close
  codes) is what later features build on.
- **MQTT** (devices): the server keeps a retained `online`/`offline` on
  `mower/status/server`, and sends firmware images as binary chunks on
  `mower/<client-id>/fw/chunk` (see [Firmware over MQTT](#firmware-over-mqtt)).
- **Login**: the app's own login page and server-side sessions in a cookie
  protect the API and the WebSocket (see
  [Login and sessions](#login-and-sessions)).

### Database

Migrations: `migrations/` (goose, embedded in the binary, run at server start).
A database the earlier Rust version migrated with sqlx is adopted on the first
start: its versions are copied from `_sqlx_migrations` into goose's table, which
stays, so nothing runs twice.

| Table | Kind | Columns |
|---|---|---|
| `users` | plain table | `id`, `username` (lower case, unique), `password_hash` (Argon2id PHC string), `created_at`, `password_changed_at` |
| `sessions` | plain table | `id_hash` (SHA-256 of the cookie token), `user_id` (→ users, cascade), `created_at`, `last_seen_at`, `expires_at`, `user_agent` |

The first migrations still create the old `records` and `record_events`
tables; a later one drops them, so every database runs the same sequence.

### Wire protocol

All browser types are defined once in Go (`internal/api`, one file per
domain) and generated for TypeScript by `cmd/gen-ts` into
`web/src/data/api/generated/`, one file per type. Device payloads (MQTT) are
not in `internal/api`: they live in their domain's `mqtt.go`.

**Why generated, and why committed:** the Go types are the single source of
truth. Structs and enums are read by reflection and the doc comments from the
source; unions (`Request`, `RpcResult`, `RpcData`, `ServerMessage`) come from the table in `internal/api/union.go`, which also
drives the JSON codec, so the two cannot drift apart. The generated files are
committed so the web app builds without a Go toolchain (the Bun stage in the
Dockerfile, the client CI job). CI regenerates them and fails if the committed
copy is stale. After changing a type: `go run ./cmd/gen-ts`, then commit the
changed files.

REST:

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/app/api/auth/login` | `{"username", "password"}` | 200 `{"username"}` + `Set-Cookie` / 401 / 429 + `Retry-After` |
| GET | `/app/api/auth/me` | | 200 `{"username"}` / 401 |
| POST | `/app/api/auth/logout` | | 204, clears the cookie (also without a session) |
| POST | `/app/api/auth/logout-all` | | 204: ends every session of the user |

Everything except login, logout and `/app/health` needs the session cookie
(else 401). Every request that changes something, and the WebSocket handshake,
needs an allowed `Origin` (else 403).

Errors: `{"code": "bad_request" | "not_found" | "internal" | "unauthorized" | "forbidden" | "too_many_requests", "message": "..."}`.

The WebSocket carries one envelope:

```jsonc
// client → server
{ "request_id": "uuid", "request": { "op": "ping" } }

// server → client
{ "type": "response", "response": { "request_id": "uuid", "result": { "status": "ok", "data": { "kind": "pong" } } } }
{ "type": "response", "response": { "request_id": "uuid", "result": { "status": "error", "error": { "code": "bad_request", "message": "..." } } } }
```

An unknown or malformed request gets a `bad_request` error with its
`request_id` (empty if the message was not JSON); the socket stays open.

MQTT topics (`<prefix>` is `mower`):

| Topic | Direction | Payload |
|---|---|---|
| `<prefix>/status/server` | server → all, **retained** | `online` / `offline` (last will) |
| `<prefix>/<client-id>/fw/req` | client → server | firmware request (JSON) |
| `<prefix>/<client-id>/fw/chunk` | server → client | one firmware chunk (binary) |
| `<prefix>/<client-id>/fw/res` | server → client | firmware info, or a JSON error |

The byte layout of a chunk, and the firmware request, are in
[Firmware over MQTT](#firmware-over-mqtt). Nothing on the `fw` topics is retained.

The client id travels in the topic (like `mower/<id>/cmd`; `status` is reserved and cannot be a client id), not in
MQTT 5 properties, so the scheme works on MQTT 3.1.1 and on small device
clients, and a broker ACL can scope each login to its own topics. The server
answers only on the topics of the id it got the request on.

## Firmware over MQTT

A device downloads a firmware image as binary chunks on the same MQTT
connection it already uses. The image file is a signed `<version>.bin` in the
server's firmware folder (Caddy's HTTPS `/fw/` download was removed on
2026-11-13). The file stays signed; the device checks the signature. This transport adds a SHA-256 of the
whole file, and the device can resume from any chunk index.

One firmware request is in flight per device. A second request that arrives
before the answer is published is ignored. A topic that does not parse is
ignored. QoS is 1. Chunks, info and errors are not retained.

The gateway side is
[rmx-mower-gateway#44](https://github.com/rmx-lt/rmx-mower-gateway/issues/44).
This section is the contract that firmware is written against.

### Request

The device publishes a JSON object on `<prefix>/<name>/fw/req`. `<name>` is
the device id, the same rules as any other client id (1–64 of
`[A-Za-z0-9_-]`; `status` is not an id).

```json
{ "request_id": "c0", "file": "1.2.3.bin", "chunk": 0 }
{ "request_id": "i0", "op": "info", "file": "1.2.3.bin" }
```

| Field | Rule |
|---|---|
| `request_id` | Required. 1–64 of `[A-Za-z0-9_-]`. |
| `op` | `chunk` or `info`. Omitted means `chunk`. Unknown fields are ignored. |
| `file` | Required. The file name only, not a path: `[A-Za-z0-9._-]+\.bin`, at most 128 characters. The version is that name (`1.2.3.bin`), the same last segment as the old HTTPS URL. |
| `chunk` | Required for `chunk`: an integer from 0. Ignored for `info`. |

The body is at most 1024 bytes. `info` is optional. Chunk 0, and every other
chunk, already carries the size, the chunk count and the SHA-256.

### Chunk frame

The answer to `chunk` is one binary MQTT payload on
`<prefix>/<name>/fw/chunk`: a 64-byte little-endian header, then the raw
bytes. No base64. Integers are little-endian. The ESP32 is little-endian, and
every field below is naturally aligned, so a packed C struct of this layout
matches the bytes.

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Magic `RMFW` (bytes `52 4D 46 57`) |
| 4 | 1 | Header version, `1` |
| 5 | 1 | Flags. Bit 0 is set: bytes 32–63 are the whole-image SHA-256. Other bits are 0 |
| 6 | 2 | Header length, `64`. The payload starts at this offset |
| 8 | 4 | Chunk index |
| 12 | 4 | Chunk count |
| 16 | 4 | Image size, in bytes |
| 20 | 2 | Chunk length: how many payload bytes follow the header |
| 22 | 2 | Reserved, `0` |
| 24 | 8 | Request-id hash: the first 8 bytes of SHA-256 over the raw UTF-8 `request_id` |
| 32 | 32 | SHA-256 of the whole image, raw bytes (not hex) |
| 64 | chunk length | The chunk |

Reject a frame whose magic, version, flags, header length or reserved field
differ, or whose MQTT payload length is not `64 + chunk length`. The SHA-256
in every chunk is the same, so a resume from the middle does not need a
separate info call. An empty file is one chunk of length 0 (the SHA-256 of
empty input). The last chunk of a longer file is shorter than the chunk size.
A chunk index at or past the chunk count is an error, not an empty frame.

```c
typedef struct __attribute__((packed)) {
    char magic[4];             /* 'R','M','F','W' */
    uint8_t version;           /* 1 */
    uint8_t flags;             /* bit 0 set */
    uint16_t header_len;       /* 64 */
    uint32_t chunk_index;
    uint32_t chunk_count;
    uint32_t image_size;
    uint16_t chunk_len;
    uint16_t reserved;         /* 0 */
    uint8_t request_id_hash[8];
    uint8_t sha256[32];
} rmx_fw_header_t;
```

### Info and errors

`info`, and every error, is JSON on `<prefix>/<name>/fw/res` (not on
`fw/chunk`).

```json
{
  "request_id": "i0",
  "op": "info",
  "file": "1.2.3.bin",
  "size": 9000,
  "sha256": "0123abcd…",
  "chunk_size": 4096,
  "chunks": 3
}
```

`sha256` here is 64 lower-case hex characters. `chunk_size` is the server's
configured size; only the last chunk is shorter.

```json
{ "request_id": "c3", "error": { "code": "bad_request", "message": "chunk is past the end of the file" } }
```

| `code` | When |
|---|---|
| `bad_request` | The JSON is not a request, the file name is not allowed, or the chunk index is past the end |
| `not_found` | No such regular file in the firmware directory |
| `internal` | The file is larger than 32 MiB, or the server could not read it |

`request_id` is empty when the id itself was missing or not valid. The
message strings are stable enough to log; branch on `code`.

### Files, chunk size, and the device buffer

`FIRMWARE_DIR` is the directory of images (read-only). Unset, the server does
not subscribe to `fw/req` and firmware is off. `FIRMWARE_CHUNK_BYTES` is the
chunk size, default **4096**, allowed **256–16384**. A file over **32 MiB**
is refused. The SHA-256 is cached in memory and recomputed when the file's
size or modification time changes. Names are looked up inside that directory
only (`os.Root`), so a name cannot escape it.

**esp-mqtt buffer.** The gateway is an ESP32. esp-mqtt's receive buffer
(`esp_mqtt_client_config_t.buffer.size`) defaults to
`MQTT_BUFFER_SIZE_BYTE`, which is **1024** unless `CONFIG_MQTT_BUFFER_SIZE`
is set (`mqtt_config.h` in espressif/esp-mqtt). A publish larger than that
buffer is still delivered, as several `MQTT_EVENT_DATA` callbacks with
`current_data_offset` and `total_data_len` (ESP-IDF v5.4.1 MQTT docs). A 4096-byte
chunk plus the 64-byte header and the MQTT framing (topic, packet id) is
about 4.2 KB, so the default 1024-byte buffer works only if the firmware
reassembles those callbacks. Set `buffer.size` to at least
`96 + FIRMWARE_CHUNK_BYTES` (5120 for the default 4096-byte chunk; 8192
leaves room to raise the chunk size later) so one event is the whole frame.
`buffer.out_size` can stay at the default: the device's request is a small
JSON publish, and esp-mqtt already fragments a publish that is larger than
the output buffer. One request in flight matches a small LTE uplink.

### Mount on the VPS

The app container does not have the firmware directory until
`rmx-server-infra` mounts it. That change is not in this repo. In
`services/app/compose.yaml`, on `app`:

```yaml
environment:
  FIRMWARE_DIR: /firmware
volumes:
  - <host directory of the images>:/firmware:ro
```

The host directory of the images is in `rmx-server-infra` (Caddy no longer
serves it; its name follows the stack's rename in
[rmx-server-infra#85](https://github.com/rmx-lt/rmx-server-infra/issues/85)). The container runs as uid
65532, so that directory needs to be readable by it (directories `0755` and
files `0644` are enough). No Mosquitto ACL change: `app` already has
readwrite `mower/#`, and each device already has `mower/<its username>/#`,
which covers `fw/req`, `fw/chunk` and `fw/res`.

## Login and sessions

How the app logs people in. Code: `internal/auth/` and
`web/src/features/auth/`.

```
browser                                   rmx-server                       TimescaleDB
  │ POST /app/api/auth/login {user,pw}       │                                 │
  │ ───────────────────────────────────────▶ │ Argon2id check (slow, 19 MiB)   │
  │                                          │ token = 32 random bytes         │
  │                                          │ INSERT sessions(sha256(token))  │──▶
  │ ◀── Set-Cookie: __Secure-app_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/app
  │                                          │                                 │
  │ GET /app/api/auth/me  (the browser adds the cookie)                        │
  │ GET /app/ws + Upgrade (the cookie too)   │ look up sha256(cookie):         │
  │ ───────────────────────────────────────▶ │ exists, not idle, not expired?  │──▶
  │ ◀── 200 / 101 Switching Protocols, or 401                                  │
  │ POST /app/api/auth/logout                │ DELETE the row                  │──▶
```

**Why a session cookie, and not basic auth or a token in JavaScript**

- *Basic auth* (what Caddy did before): the browser sends the password itself
  with every request, there is no real logout, and iOS WebKit doesn't send it
  on WebSocket handshakes (the WSS of the first, Caddy-protected version failed on iPhones). Browsers do
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
| Password hash | Argon2id (m = 19 MiB, t = 2, p = 1), random salt | OWASP's recommendation. Slow and memory-hard, so stolen hashes are expensive to crack. The PHC string stores its parameters, so they can be raised later. One check at a time, because the app container has a 64 MB memory limit. |
| Password rules | 12–256 characters, nothing else | NIST SP 800-63B: length matters, composition rules don't. |
| Session id | 32 bytes from the OS random generator (64 hex characters) | 256 bits can't be guessed. |
| Stored as | SHA-256 of the token | A leaked database dump has no working sessions. A fast hash is fine because the token is random (passwords need the slow one). |
| Timeouts | idle 7 days (sliding), absolute 30 days | Stay logged in on your own phone, but nothing lives forever. `last_seen_at` is written at most once a minute. Timed-out rows are deleted every hour. |
| Logout | deletes the row, clears the cookie | The cookie is worthless afterwards, even if someone copied it. "Log out everywhere" and `set-password` delete all rows of the user. Open WebSockets re-check their session with every ping (30 s) and are closed with code 4001. |
| New session id at every login | yes | Prevents session fixation. |
| `HttpOnly` | yes | Scripts can't read the cookie. |
| `Secure` | yes | HTTPS only. (Browsers treat `http://localhost` as secure, so local development works.) |
| `SameSite` | **Strict** | The cookie is never sent on requests that another site starts, so a foreign page can't use it (CSRF). Lax would also send it when someone follows a link here from another site; we don't need that, because the page (static files) is public and only its own same-site API calls need the cookie. |
| `Path` | `/app` | The app shares `api.rmx.lt` with other services; its cookie stays under `/app`. |
| Prefix | `__Secure-`, not `__Host-` | `__Host-` would be stronger (it also forbids `Domain=`, so a sibling like `rmx.lt` couldn't plant a cookie with the same name), but it requires `Path=/`. If a request carries our cookie name twice, the server treats it as logged out rather than guess which one is real. If the app ever gets an origin of its own, it should use `__Host-session; Path=/`. |
| CSRF | SameSite **plus** an `Origin` check | SameSite works per *site* (all of `rmx.lt`), and not every browser enforces it. Every request that isn't GET/HEAD/OPTIONS, and every WebSocket handshake, must have an `Origin` from `ALLOWED_ORIGINS`, or it gets 403. The login too (no "log the victim into the attacker's account"). WebSockets matter most: CORS doesn't cover them, so without this any website could open one with the user's cookie ("cross-site WebSocket hijacking"). |
| Password guessing | in-memory backoff per username and per IP | 5 free failures per username (20 per IP), then 1 s, 2 s, 4 s … up to 15 min; while waiting, even the right password gets 429. Unknown usernames are checked against a dummy hash, so they take as long and get the same answer. A restart forgets the counters; several instances would need a shared store. |
| Client IP | last `X-Forwarded-For` entry, else the TCP peer | Caddy sets that header; the app's port is not published, so only Caddy reaches it. |
| Caching | `Cache-Control: no-store` behind the login | No copy of user data in a shared cache, or in the back button after logout. |

**What's public:** `/app/health` (only up/down and the version, for the
deploy script and monitoring), login and logout, and the web app's static files
(the same code as in this repository, no data). The router (`internal/httpx`)
has only two ways to add a route, `Public()` and `Protected()`, and every
`Protected()` route needs a session. A unit test (`internal/app/routes_test.go`)
compares the public routes with an allow-list, so a new public route fails CI
until someone deliberately adds it there.

**MQTT is for devices only.** Browsers don't talk to Mosquitto: they go
through the server's WebSocket with their session, so there is one login for
people and one place that checks it. Devices have their own broker logins
(one per device on the VPS), limited by the broker's ACL to their own
topics.

### Users

There is no sign-up page. Users are managed with subcommands of the server
binary, which need only `DATABASE_URL` and run the migrations first. The
password is read from **stdin** (on a terminal: asked twice, not shown), never
from the command line, which would end up in the shell history and the
process list.

```powershell
# Local development (DATABASE_URL comes from .env):
go run ./cmd/rmx-server create-user alice      # asks for the password
go run ./cmd/rmx-server set-password alice     # new password, ends all sessions
go run ./cmd/rmx-server delete-user alice      # also deletes the sessions
```

On the VPS, inside the running container (distroless: no shell, so the
password is piped in from the host):

```bash
docker compose exec -T app /app/rmx-server create-user admin < password-file
```

Usernames: 1–32 characters `a-z 0-9 . _ -`, case-insensitive. Passwords:
12–256 characters. There is no default user and no default password.

## Repository layout

The layout keeps boundaries checked by tests and lint, not by convention, so
new domains and the ported blade-terminal client fit without a later move.

### Go

```
go.mod, go.sum          Go module (go 1.26), staticcheck pinned as a tool
cmd/rmx-server/         main: serve, healthcheck, user commands (imports app only)
cmd/gen-ts/             TypeScript generator; reads internal/api only
internal/
  app/                  composition root: construct, wire, start/stop, health, static files, CLI
  buildinfo/            Version (the -ldflags target)
  core/                 leaf types: DeviceID (+ validation), UserID, CurrentUser, context accessors
  api/                  browser contract: REST + WebSocket types, unions, error codes; one file per domain
  config/ apperr/ clientip/
  db/                   pool, migrations, DBTX (pool or transaction), InTx
  events/               generic in-process bus; a slow subscriber is dropped
  httpx/                Router with Public() / Protected() only, JSON helpers
  mqtt/                 broker client, topic grammar <prefix>/<device>/<suffix>, suffix → handler
  ws/                   connections, op → handler routing, event push
  auth/ firmware/       domains (later: devices, telemetry, commands, planning), files:
                          service.go, store.go (all SQL, takes db.DBTX), http.go, ws.go,
                          mqtt.go (device payloads + topic suffixes), as far as the domain needs them
  integration/          harness (fresh database, own topic prefix, logged-in client)
                          + one _test.go per domain
  arch/                 arch_test.go: the import rules below
migrations/             one goose sequence; new files <timestamp>_<domain>_<what>.sql (the first four predate this)
```

Import rules (default deny: `internal/arch/arch_test.go` lists every package
with its layer, from `go list`; a package that is not listed fails the test):

- **Leaves** (`core`, `api`, `buildinfo`, `migrations`) import nothing internal.
- **Platform** (`config`, `db`, `events`, `httpx`, `mqtt`, `ws`, `apperr`,
  `clientip`) imports leaves and other platform packages, never a domain.
  (`apperr` imports `api` for the error codes.)
- **Domains** import platform and leaves, never another domain. A
  cross-domain need is a small interface declared by the consumer (e.g.
  `commands.DeviceLookup`), satisfied by the other domain and injected by `app`.
- Only `app` and `integration` import everything. `cmd/rmx-server` imports
  only `app`, `cmd/gen-ts` only `api`.
- Each table has one owning domain; foreign keys to `devices` / `users` are
  fine, cross-domain queries are not. A cross-domain write uses `db.InTx`
  and passes the transaction to both stores. Events are published after the
  commit; state that must survive (such as a command's ack or expiry) lives
  in the database, not on the bus.
- Third-party fences: paho only in `mqtt`, coder/websocket only in `ws`, pgx
  (and goose) only in `db` and in the domains' `store.go` files. The
  integration tests are exempt: they play the browser and the devices.

Not used, on purpose: several Go modules, `pkg/`, an interface around every
store, an outbox or external bus, an ORM, OpenAPI, sqlc (for now),
per-domain migration folders.

### web/

```
web/                    React 19 + TS on Bun (same toolchain as blade-terminal)
  public/index.html     HTML entry (Bun HTML import)
  dev/server.ts         dev server: HMR + proxy to rmx-server
  scripts/build.ts      production build → dist/
  src/
    app/                main, App, providers, login gate, connection status
    layouts/            shell regions; compose features
    features/<name>/    {components,hooks,stores,data,utils,types}; today: auth
    model/              state several features share
    data/               the functions features call
      api/              http + WebSocket clients; generated/ (cmd/gen-ts output, committed)
      local/            Dexie schema, row types, queries (the only importer of dexie)
    components/         generic widgets only
    hooks/ utils/ config/ styles/ assets/ testing/
```

Folders are created when the first file needs them.

Rules, enforced by `bun run lint` (`web/eslint.config.mjs`, with
eslint-plugin-boundaries):

- Layers import one way: shared (`components`, `hooks`, `utils`, `config`,
  `styles`, `assets`, `testing`) → `data` → `model` → `features` → `layouts`
  → `app`. Every file under `src/` belongs to a layer.
- Features don't import other features, except into an allow-list
  (`canvas-editing`, `ui-manager`); anything else they share moves to `model/`.
- Only `src/data/` imports the generated wire types (`@/data/api/generated`);
  the rest imports the types `data/api` exports. Only `src/data/local/`
  imports `dexie`.
- No `index.ts` re-export files; imports use the `@/` alias; tests sit in
  `__tests__/` next to the code.
- When data moves between the browser and the server, only `data/` changes.

### Other files

```
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
go run ./cmd/rmx-server

# 4. The web dev server, in a second terminal.
cd web
bun install
bun run dev
```

Create a login once (the dev database keeps it), then open
<http://localhost:3000/app/> and log in:

```powershell
go run ./cmd/rmx-server create-user dev     # any password of 12+ characters
```

To try MQTT like a device, use any MQTT client on `127.0.0.1:11883` as
`test-device` with the `TEST_DEVICE_PASSWORD` from `.env`
(`test-device-dev`), publishing to `mower/<client-id>/fw/req` (needs
`FIRMWARE_DIR`) or watching `mower/status/server`.

Local ports (chosen so they don't clash with a Postgres or Mosquitto
installed on the PC):

| Port | What |
|---|---|
| 3000 | Bun dev server (web app with hot reload) |
| 8080 | rmx-server |
| 55432 | TimescaleDB (`postgres://app:db-dev@127.0.0.1:55432/app`) |
| 11883 | Mosquitto, plain MQTT (the server and test devices) |

**How the dev server works.** `bun run dev` runs `web/dev/server.ts`:
`Bun.serve` with an HTML import of `public/index.html`, so Bun bundles the app
on the fly with hot module reloading and Tailwind (`bun-plugin-tailwind` in
`bunfig.toml`). The same server proxies `/app/api/*`, `/app/health`,
and the `/app/ws` WebSocket to rmx-server (passing
on the session cookie and `Origin`, which rmx-server checks)
(`BACKEND_URL`, default `http://127.0.0.1:8080`). The browser sees a
single origin with the same paths as production, so there is no CORS and no
environment-specific URL in the client code.

Stop the stack with `docker compose -f compose.dev.yaml down` (add `-v` to
also delete the database volume).

Run the production image against the dev stack:

```powershell
docker build -t rmx-server-app:local .
docker run --rm -p 8080:8080 `
  -e DATABASE_URL=postgres://app:db-dev@host.docker.internal:55432/app `
  -e MQTT_HOST=host.docker.internal -e MQTT_PORT=11883 `
  -e MQTT_USERNAME=app -e MQTT_PASSWORD=app-dev `
  -e ALLOWED_ORIGINS=http://localhost:8080 `
  rmx-server-app:local
```

Then open <http://localhost:8080/app/>.

## Tests and checks

| What | Command |
|---|---|
| Format | `gofmt -l .` (prints nothing when formatted) |
| Lint | `go vet ./...` and `go tool staticcheck ./...` |
| Unit tests | `go test -race ./...` |
| Integration tests (needs the compose stack and `.env`) | `go test -tags integration -count=1 ./...` |
| Regenerate TS types | `go run ./cmd/gen-ts` |
| Web lint (incl. layer boundaries) / types / tests / build | `cd web; bun run check` (lint, typecheck, `bun test`, build) |

`go test ./...` includes the import rules (`internal/arch`) and the public-route
allow-list (`internal/app`).

The integration tests (`internal/integration/`: `harness_test.go`, then
`app_test.go`, `auth_test.go`, `firmware_test.go`) start the real
server on a random port; each test creates a fresh migrated database, and uses
its own MQTT topic prefix, so they run in parallel. They cover the WebSocket
ping, a firmware download (every chunk, including a resume from the middle,
checked against the file's SHA-256), health, that the records routes and
tables are gone, the retained server status and graceful shutdown, and the
login: wrong
password and unknown user, protected routes (REST, WebSocket)
without, with a forged and with a duplicated cookie, expired and idle
sessions, logout and "log out everywhere", password change, session
fixation, foreign `Origin`s (REST, login, WebSocket) and the rate limit.

**Queries** are plain SQL strings checked at run time by the integration tests,
so after changing one, run them.

## CI/CD

`.github/workflows/ci.yml`, on every pull request and push:

1. **go**: gofmt, `go vet`, staticcheck, `go test -race` (with the import rules), TS types up to date.
2. **client** (the web app in `web/`; the job keeps its name, a required check): `bun install --frozen-lockfile`, eslint, tsc, `bun test`, build.
3. **integration**: `compose.dev.yaml` up, integration tests.
4. **image**: after 1–3 pass, builds the Docker image (cached in the GitHub
   Actions cache). On pull requests and `development` it is only built. On
   `production` it is pushed as `sha-<short>` and `production`; on a `v*` tag
   as `X.Y.Z` and `X.Y`.
5. **deploy**: only on `production`, sends the new tag to the VPS (see below).

Dependabot (`.github/dependabot.yml`) opens weekly updates for Go modules, the
web app (`web/`, bun ecosystem: `package.json` + `bun.lock`), GitHub Actions and the
Dockerfile's base images.

## Deployment

This is the contract the VPS side (repo `rmx-server-infra`) can rely on.

**Image:** `ghcr.io/rmx-lt/rmx-server-app`, public, linux/amd64. (Images up to
2026-11-13 were published as `ghcr.io/rmx-lt/rmx-backend-probe`, the repo's old name.)

| Tag | Meaning |
|---|---|
| `sha-<short>` | every push to `production` (deploy this one: immutable) |
| `production` | latest `production` |
| `X.Y.Z`, `X.Y` | release tags `vX.Y.Z` |

**Container:**

- Listens on **`0.0.0.0:8080`** (HTTP; TLS is Caddy's job). Publish no port;
  Caddy reaches it over the Docker network.
- Runs as uid **65532** (distroless `nonroot`), no shell. Needs no volumes
  unless `FIRMWARE_DIR` is set (see [Firmware over MQTT](#firmware-over-mqtt)).
- `HEALTHCHECK` built in (`/app/rmx-server healthcheck` → `GET /app/health`).
- Stops cleanly on SIGTERM (closes WebSockets, publishes MQTT `offline`).
- Memory: about 15 MB at idle; a login briefly needs ~20 MB more (Argon2, one at
  a time). `mem_limit: 64m` is enough: the image sets `GOMEMLIMIT=40MiB` so the
  Go garbage collector gives memory back early (measured about 35 MiB with 30
  parallel logins).
- Networks: `backend` (database) and `edge` (Mosquitto, Caddy).

**Environment:**

| Variable | Required | Example (VPS) | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | `postgres://app:…@db:5432/app` | migrations run at start. No TLS (internal network). |
| `MQTT_HOST` | yes | `mosquitto` | plain MQTT on the internal network |
| `MQTT_PORT` | no | `1883` | default 1883 |
| `MQTT_USERNAME` | yes | `app` | ACL: readwrite `mower/#` |
| `MQTT_PASSWORD` | yes | (secret, server-side `.env`) | never logged |
| `ALLOWED_ORIGINS` | **yes** | `https://api.rmx.lt` | comma-separated origins of the page. Others can't log in, change data or open the WebSocket (403). The server doesn't start without it |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error`. The Rust version's `RUST_LOG` is ignored |
| `BIND_ADDR` | no | `0.0.0.0:8080` | already set in the image |
| `MQTT_CLIENT_ID` | no | `rmx-server` | must be unique on the broker |
| `MQTT_TOPIC_PREFIX` | no | `mower` | |
| `DB_MAX_CONNECTIONS` | no | `5` | |
| `STATIC_DIR` | no | `/app/static` | already set in the image |
| `FIRMWARE_DIR` | no | `/firmware` | directory of `*.bin` images. Unset: firmware requests are not served. See [Firmware over MQTT](#firmware-over-mqtt) |
| `FIRMWARE_CHUNK_BYTES` | no | `4096` | 256–16384. Every chunk except the last is this long |

**Database:** TimescaleDB on Postgres 17 (`timescale/timescaledb:2.30.2-pg17`
or newer 2.x). The first migration runs `CREATE EXTENSION IF NOT EXISTS
timescaledb`, so the database user must own the database and either be a
superuser (the image's `POSTGRES_USER` is) or the extension must already exist.

**Routes the app serves itself** (Caddy proxies `api.rmx.lt/app` and `api.rmx.lt/app/*` as-is and
must **not** strip the `/app` prefix). The app does its own login, so Caddy
needs no `basic_auth` in front of it:

| Path | Login | What |
|---|---|---|
| `/app` | public | 308 redirect to `/app/` |
| `/app/` and other unknown `/app/*` | public | the client (static files, `index.html` fallback); it shows the login form |
| `/app/api/auth/login`, `/app/api/auth/logout` | public | login, logout |
| `/app/health` | public | `{"status":"ok","db":true,"mqtt":true,"version":"0.1.0"}`, 200 or 503 |
| `/app/api/auth/me`, `/app/api/auth/logout-all` | session | REST |
| `/app/ws` | session | WebSocket (Caddy proxies upgrades by default) |

**Proxy requirements:** pass on `Host`, `Origin` and `Cookie` unchanged (Caddy
does by default) and set `X-Forwarded-For` (Caddy does; the login rate limit
uses it). **First user:** see [Users](#users).

**MQTT devices** connect to the broker's public TLS listener (VPS:
`mqtts://mqtt.rmx.lt:8883`, `use_username_as_clientid`), so a device's client
id is its login. Its ACL needs: its own `mower/<login>/#` (covered by the broker's
`pattern readwrite mower/%u/#`) plus read
`mower/status/server`. The broker needs no WebSocket listener and Caddy no MQTT
route: browsers don't use MQTT. An old `MQTT_WS_URL` in the
environment is ignored.

**Deploy job:** every push to `production` deploys automatically (`feat/…` → PR → `development` → PR → `production`). After the `image`
job, the `deploy` job in `ci.yml` connects over SSH as the VPS user `deploy`
and sends only the tag `sha-<short>`. That user's key is restricted to one
forced command, the deploy script in `rmx-server-infra` (it moves from the old
probe stack to `services/app/` in
[rmx-server-infra#85](https://github.com/rmx-lt/rmx-server-infra/issues/85)).
It checks the tag, pulls the image, restarts `app`, waits for
`/app/health`, and rolls back to the previous tag if the new one isn't
healthy (the job then fails).

Repository secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (the private key),
`DEPLOY_KNOWN_HOSTS` (the VPS's ed25519 host-key line, pinned). Rotating the
key is described on the wiki page [Server-Infra](Server-Infra) (§10).

## License

[Apache-2.0](https://github.com/rmx-lt/rmx-server-app/blob/development/LICENSE).
