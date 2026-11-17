# Server-App (rmx-server-app)

The backend and web app of **Blade of Grass**, an open-source robotic lawn mower
(Go backend, React frontend). Today it serves login and sessions, a WebSocket
for the browser, firmware images and path files to the mower's boards over MQTT
(see [Firmware over MQTT](#firmware-over-mqtt)), what the mower reports (state,
metric catalogues, telemetry, events; see [Mower ingest](#mower-ingest)), the
commands, live driving and monitor streams it sends the mower (see
[Mower commands](#mower-commands)), and the web app: the planning workbench ported
from blade-terminal (see [Web app](#web-app)); the other mower features build on that.

The stack: a Go server (`net/http`, pgx, goose, paho.golang,
coder/websocket), a TypeScript + React client on Bun's bundler, TimescaleDB,
Mosquitto, GitHub Actions, images on GHCR. The server was written in Rust first
and ported to Go in November 2026, when the backend language was decided
(rmx-server-app#24).

## Contents

- [How it works](#how-it-works)
- [Firmware over MQTT](#firmware-over-mqtt)
- [Mower ingest](#mower-ingest)
- [Mower commands](#mower-commands)
- [Login and sessions](#login-and-sessions)
- [Planning API](#planning-api)
- [Web app](#web-app)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Tests and checks](#tests-and-checks)
- [CI/CD](#cicd)
- [Deployment](#deployment) (contract for the VPS side)
- [License](#license)

## How it works

```
browser ──HTTPS/WSS :443──▶ Caddy ──▶ rmx-server :8080 ──▶ TimescaleDB
          /api, /ws                         ▲
                                            │ mqtt:1883 (plain, internal)
device ──MQTT over TLS :8883──────────▶ Mosquitto
```

This is the production layout: **browsers never speak MQTT**. Only devices
(mowers, the LTE gateway) and the server do, directly with Mosquitto on 8883;
Caddy only renews the certificate Mosquitto uses. Browsers talk to the server
over HTTPS and its WebSocket, with their session.

- **HTTPS**: login and logout under `/api/auth`, the user's maps
  and settings under `/api/maps` and `/api/settings` (see [Planning API](#planning-api)), the
  devices under `/api/devices` (see [Mower ingest](#mower-ingest)), their commands
  and monitor streams (see [Mower commands](#mower-commands)), `/health`,
  and the built client at `/`.
- **WSS**: `/ws`, JSON request/response with a `request_id`, plus messages the
  server pushes. Requests: `ping`, the device requests of
  [Mower ingest](#mower-ingest), and live driving and monitor streams of
  [Mower commands](#mower-commands); the connection (session check, keep-alive,
  close codes) is what later features build on.
- **MQTT** (devices): the server keeps a retained `online`/`offline` on
  `mower/status/server`, is the only publisher of commands and live-driving
  setpoints (see [Mower commands](#mower-commands)), serves firmware images and
  path files as binary chunks (see [Firmware over MQTT](#firmware-over-mqtt)),
  and stores what the gateway and the autopilot publish under
  `mower/<name>/gateway/…` and `mower/<name>/autopilot/…` (see [Mower ingest](#mower-ingest)).
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
| `maps` | plain table | `id`, `user_id` (→ users, cascade), `name` (1–100 characters), `revision` (starts at 1, +1 per save), `doc` (JSONB: the map's zones, with their areas, and geo anchor, see [Planning API](#planning-api)), `created_at`, `updated_at` |
| `user_settings` | plain table | `user_id` (→ users, cascade), `key`, `value` (JSONB), `updated_at`; primary key `user_id` + `key` |
| `devices` | plain table | `name` (primary key; the device name from the topics), `first_seen_at`, `last_seen_at`, `gateway_status` (`online` / `offline` / null), `gateway_status_at` |
| `board_state` | plain table | `device` (→ devices, cascade), `board` (`gateway` / `autopilot`), `boot` and `boot_seen_at` (last boot counter seen in any message of the board), `state` (JSONB: the last state message as published) and `state_received_at`; primary key `device` + `board` |
| `catalogue_parts` | plain table | every catalogue message as received: `device`, `board`, `part` (`index` or a part name), `revision`, `doc` (JSONB), `received_at`; primary key `device` + `board` + `part` |
| `catalogues` | plain table | the catalogue in use per `device` + `board`: `revision`, `doc` (JSONB), `updated_at` |
| `device_events` | plain table | autopilot events: `device`, `board`, `boot`, `seq`, `time`, `event`, `data` (JSONB: the other fields), `received_at`; primary key `device` + `board` + `boot` + `seq` |
| `metric_latest` | plain table | the newest value per `device` + `board` + `metric`: `time`, `boot`, `value` (null: not known) |
| `commands` | plain table | the commands the server sent: `id` (primary key), `device`, `board`, `cmd`, `params` (JSONB, **never a secret**), `state` (`sent`, `accepted`, `done`, `failed`, `unknown`), `error`, `message`, `result` (JSONB), `attempts` (1 to 4), `requested_by`, `created_at`, `updated_at`, `finished_at`. The monitor keep-alives are not stored |
| `ntrip_sent` | plain table | per `device`: a keyed fingerprint of the caster settings its gateway acknowledged (not the password, and it cannot be turned back into it), `sent_at` |
| `paths` | plain table | the path files the mower downloads: `id` (primary key; the path id of [Mower-Protocol](Mower-Protocol) §11), `doc` (bytea, the file's bytes exactly as the mower gets them, at most 1 MiB), `size` and `sha256` (both generated from `doc`, so they cannot disagree with it), `created_at` |
| `telemetry` | hypertable | `time`, `device`, `board`, `metric`, `boot`, `value` (double): one row per known value; daily chunks, compressed after a day, no retention policy yet |

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
| POST | `/api/auth/login` | `{"username", "password"}` | 200 `{"username"}` + `Set-Cookie` / 401 / 429 + `Retry-After` |
| GET | `/api/auth/me` | | 200 `{"username"}` / 401 |
| POST | `/api/auth/logout` | | 204, clears the cookie (also without a session) |
| POST | `/api/auth/logout-all` | | 204: ends every session of the user |

Everything except login, logout and `/health` needs the session cookie
(else 401). Every request that changes something, and the WebSocket handshake,
needs an allowed `Origin` (else 403).

Errors: `{"code": "bad_request" | "not_found" | "internal" | "unauthorized" | "forbidden" | "too_many_requests" | "conflict", "message": "..."}`.

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

The contract between the mower and the server is wiki [Mower-Protocol](Mower-Protocol): topics, payloads,
commands, chunk transfer. The server implements the state, catalogue, telemetry
and event topics of it (see [Mower ingest](#mower-ingest)), the commands, live
driving and monitor (see [Mower commands](#mower-commands)) and chunk transfer
(see [Firmware over MQTT](#firmware-over-mqtt)); path planning, border recording
and the autopilot's side of them follow
([blade-of-grass#6](https://github.com/rmx-lt/blade-of-grass/issues/6)).

MQTT topics (`<prefix>` is `mower`; the full table is wiki
[Mower-Protocol](Mower-Protocol) §3):

| Topic | Direction | Payload |
|---|---|---|
| `<prefix>/status/server` | server → all, **retained** | `online` / `offline` (last will) |
| `<prefix>/<name>/<board>/cmd` | server → device | a command (JSON), QoS 1; `<board>` is `gateway` or `autopilot` |
| `<prefix>/<name>/<board>/cmd/ack` | device → server | the ack of a command |
| `<prefix>/<name>/autopilot/drive` | server → device | a live-driving setpoint, QoS 0 |
| `<prefix>/<name>/<board>/monitor` | device → server | monitor samples, QoS 0 |
| `<prefix>/<name>/gateway/fw/…`, `autopilot/fw/…`, `autopilot/path/…` | both | chunk transfer: `req` (device → server), `chunk` and `res` (server → device) |
| `<prefix>/<name>/gateway/#`, `<prefix>/<name>/autopilot/#` | device → server | subscribed as a whole; the topics handled are in [Mower ingest](#mower-ingest) |

The byte layout of a chunk, and the request, are in
[Firmware over MQTT](#firmware-over-mqtt). Nothing on these topics is retained.

The device name travels in the topic (`status` is reserved and cannot be a
device name), not in MQTT 5 properties, so the scheme works on MQTT 3.1.1 and on
small device clients, and a broker ACL can scope each login to its own topics.
The server answers only on the topics of the name it got the request on.

## Firmware over MQTT

A board downloads a firmware image or a path file as binary chunks on the same
MQTT connection it already uses: **chunk transfer**, wiki
[Mower-Protocol](Mower-Protocol) §12 (the contract; this section says how the
server does it). The files stay signed or checked by the board; the transport
adds the SHA-256 of the whole file to every chunk, so a download can start or
continue at any chunk. Code: `internal/transfer/`.

Three topic sets, each with its own source, so a request on one set can only
reach that set's files:

| Topics (below `<prefix>/<name>/`) | Who asks | Files | Source |
|---|---|---|---|
| `gateway/fw/req`, `chunk`, `res` | gateway | `<version>.bin` | directory `$FIRMWARE_DIR/gateway/` |
| `autopilot/fw/req`, `chunk`, `res` | autopilot | `<version>.bin` | directory `$FIRMWARE_DIR/autopilot/` |
| `autopilot/path/req`, `chunk`, `res` | autopilot | `<path>.json` | table `paths`, row `id = <path>` |

A firmware set whose directory is not there serves no files: every request gets
`not_found`. Names are looked up inside the directory only (`os.Root`), so a name
cannot escape it. A firmware image is at most 32 MiB. The SHA-256 is cached in
memory and recomputed when the file's size or modification time changes. A path
file is the `doc` of its row (at most 1 MiB) and its hash is the row's `sha256`;
a name that is not `<id>.json` of a stored path gets `not_found`.

A path gets into the table through `transfer.StorePath(ctx, q, id, doc)`, an
internal function (no HTTP route): the tests and, until jobs exist, nothing else
call it. It keeps the bytes as given, so the `size` and `sha256` of a
`path_start` command are the row's.

**One request open per topic set.** A board has one request open per set, and the
server answers requests on different sets side by side: a path file and a firmware
image download at the same time. A second request on the same set that arrives
before the answer to the first is published is ignored (the board asks again
after its 10 s). QoS is 1. Chunks and errors are not retained. A topic that does
not parse is ignored.

### Request

The board publishes a JSON object on `<set>/req`:

```json
{ "request_id": "c0", "file": "1.2.3.bin", "chunk": 0 }
```

| Field | Rule |
|---|---|
| `request_id` | Required. 1–64 of `[A-Za-z0-9_-]`, new for every request. |
| `file` | Required. 1–128 of `[A-Za-z0-9._-]`, never a path (`.` and `..` are refused). |
| `chunk` | Required. An integer from 0. Unknown fields are ignored. |

The body is at most 4096 bytes. There is no `info` request: every chunk carries
the size, the chunk count and the SHA-256.

### Chunk frame

The answer is one binary MQTT payload on `<set>/chunk`: a 64-byte little-endian
header, then the chunk's bytes. Every field is naturally aligned, so a packed C
struct of this layout matches the bytes.

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Magic `RMFW` (bytes `52 4D 46 57`) |
| 4 | 1 | Header version, `1` |
| 5 | 1 | Flags, `1`: bytes 32–63 are the whole-file SHA-256 |
| 6 | 2 | Header length, `64`. The chunk starts at this offset |
| 8 | 4 | Chunk number |
| 12 | 4 | Number of chunks in the file |
| 16 | 4 | File size, in bytes |
| 20 | 2 | Chunk length: how many bytes follow the header |
| 22 | 2 | Reserved, `0` |
| 24 | 8 | Request-id hash: the first 8 bytes of SHA-256 over the raw UTF-8 `request_id` |
| 32 | 32 | SHA-256 of the whole file, raw bytes (not hex) |
| 64 | chunk length | The chunk |

A chunk is **4096 bytes**, fixed; only the last one of a file is shorter. An
empty file is one chunk of length 0 (with the SHA-256 of empty input). A board
drops a chunk whose magic, version, flags, header length or reserved field
differ, whose MQTT payload is not `64 + chunk length`, or whose request-id hash
is not that of its open request. A chunk number at or past the chunk count is an
error, not an empty frame.

```c
typedef struct __attribute__((packed)) {
    char magic[4];             /* 'R','M','F','W' */
    uint8_t version;           /* 1 */
    uint8_t flags;             /* 1 */
    uint16_t header_len;       /* 64 */
    uint32_t chunk_index;
    uint32_t chunk_count;
    uint32_t file_size;
    uint16_t chunk_len;
    uint16_t reserved;         /* 0 */
    uint8_t request_id_hash[8];
    uint8_t sha256[32];
} rmx_chunk_header_t;
```

### Errors

An error is JSON on `<set>/res` (never on `chunk`):

```json
{ "request_id": "c3", "error": { "code": "not_found", "message": "no such file" } }
```

| `code` | When |
|---|---|
| `bad_request` | The JSON is not a request, the file name is not allowed, or the chunk number is past the end |
| `not_found` | No such regular file in that set, or no such path in the table |
| `internal` | The server could not read the file, or it is too large |

`request_id` is empty when the id itself was missing or not valid. Branch on
`code`; the message is for logs.

### Files and settings

`FIRMWARE_DIR` is the directory of firmware images (read-only) with the
subdirectories `gateway/` and `autopilot/`; a missing subdirectory leaves that
set empty (logged at start). Unset, the firmware sets are not served. Paths have
no setting: they are in the database. There is no chunk-size setting.

**esp-mqtt buffer.** The gateway is an ESP32. esp-mqtt's receive buffer
(`esp_mqtt_client_config_t.buffer.size`) defaults to
`MQTT_BUFFER_SIZE_BYTE`, which is **1024** unless `CONFIG_MQTT_BUFFER_SIZE`
is set (`mqtt_config.h` in espressif/esp-mqtt). A publish larger than that
buffer is still delivered, as several `MQTT_EVENT_DATA` callbacks with
`current_data_offset` and `total_data_len` (ESP-IDF v5.4.1 MQTT docs). A 4096-byte
chunk plus the 64-byte header and the MQTT framing (topic, packet id) is
about 4.2 KB, so the default 1024-byte buffer works only if the firmware
reassembles those callbacks. Set `buffer.size` to at least 5120 (8192 leaves
room) so one event is the whole frame. `buffer.out_size` can stay at the
default: the board's request is a small JSON publish.

### Mount on the VPS

The app container does not have the firmware directory until `rmx-server-infra`
mounts it. That change is not in this repo. In `services/app/compose.yaml`, on
`app`:

```yaml
environment:
  FIRMWARE_DIR: /firmware
volumes:
  - <host directory of the images>:/firmware:ro
```

Paths need no mount: they are in the database
([rmx-server-infra#109](https://github.com/rmx-lt/rmx-server-infra/issues/109)
removes the old path directory from the stack).

The images move into `gateway/` and `autopilot/` below the host directory: the
single flat directory the server served before this layout is not read any more.
The host directory is in `rmx-server-infra` (Caddy no longer serves it; its name
follows the stack's rename in
[rmx-server-infra#85](https://github.com/rmx-lt/rmx-server-infra/issues/85)). The
container runs as uid 65532, so the directories need to be readable by it
(directories `0755` and files `0644` are enough). No Mosquitto ACL change: `app`
already has readwrite `mower/#`, and each device already has
`mower/<its username>/#`, which covers every topic above.

## Mower ingest

What the mower tells the server, and what the server shows of it. The contract
is wiki [Mower-Protocol](Mower-Protocol) §3, §4, §6, §7 and §16; this section
says what the server does with it. Code: `internal/mower/` (`mqtt.go` payloads,
`catalogue.go`, `store.go`, `service.go`, `http.go`, `ws.go`), wire types in
`internal/api/mower.go`. The command acks and monitor samples that arrive on the
same subscription are handled by [Mower commands](#mower-commands).

**The server holds no formulas or hardware constants.** It stores and shows
what the mower sends. The one thing it knows about a mower is the list of keys
of §16.4 (`Keys` in `catalogue.go`); everything else (which values exist,
their units, ranges and warning levels) comes from the board's catalogue.

### What is subscribed and handled

The server subscribes to `<prefix>/+/gateway/#` and `<prefix>/+/autopilot/#`
with a clean session, so retained state and catalogues arrive again after every
connect. Messages of one subscription are handled one at a time, in order
(`mqtt.HandleTree`); at most 4096 wait, a later one is dropped and logged. The
topics the domain handles:

| Topic | What the server does |
|---|---|
| `gateway/status` | `online` / `offline` into `devices.gateway_status` |
| `gateway/state`, `autopilot/state` | keeps the message as published in `board_state` |
| `gateway/telemetry`, `autopilot/telemetry` | stores every value (below) |
| `autopilot/event` | stores the event unless it was seen (below) |
| `gateway/metrics/<part>`, `autopilot/metrics/<part>` | catalogue (below) |

Everything else under these trees (commands, acks, monitor, chunk transfer) is
ignored until its feature exists. A device is **learned from its topics**: the
first valid message creates it, and every message sets `last_seen_at`. A
message over 4096 bytes, one that is not the JSON object the contract
describes, or an unknown status text is dropped and logged; an empty payload
(an emptied retained topic) is ignored.

### State and the boot counter

The state is stored as sent (shown unchanged in the API). Each board's `boot`
(§4.1) is read from its state, telemetry and events. A `boot` higher than the
stored one means the board restarted: the server records it (`boot_seen_at`)
and pushes a `device_changed` with change `boot`. A lower one is ignored for
this purpose, because the counter only grows and a lower value is a message
held up from before the restart. Every stored value carries its `boot`.
The `speed_limit` field of the autopilot's state (§7.1: `max`, `transit`,
`edge`, `fill`, `manual`, in m/s) is stored and shown like the rest of it; the
server reads nothing from it.

`autopilot_stale` is true while the gateway's status is not `online` or the
gateway's state says `autopilot_link` is not `up` (§7.1), and also while the
server has neither yet. The autopilot's state is still returned, marked out of
date. `protocol_supported` says whether the server supports the protocol a
board reports (§2): the same major version, and while the major version is 0,
the same minor too (the server implements 0.1). The server sends no commands
yet, so nothing is withheld from an unsupported board.

### Catalogues

Each board publishes an `index` (revision and part names) and one message per
part (§16.1). Every message is stored as received (`catalogue_parts`); after
each one the server tries to assemble the catalogue. It **uses a catalogue only
when complete**: the index, and every part it lists, all with the index's
revision. Until then the catalogue in use stays as it was, and the device
shows the waiting revision as `pending_revision` with the `missing_parts`.
Retained parts the index does not list are ignored.

An entry that does not follow §16.2 (a missing required field, a bad name, an
enum without values, a name twice) is left out and logged, so one bad entry
does not hide the rest; a key it would have linked is then not linked. A key
on a family entry (`usage.mqtt.up.*`) is ignored: its members are not known.

### Keys

The keys of §16.4 are resolved over the catalogues in use of both boards,
whenever a device is read. Each key gets one state:

| State | When |
|---|---|
| `linked` | exactly one metric names the key (`board` and `metric` say which), with the key's type; for `gnss.fix` the metric's `values` are the key's, in order |
| `missing` | no metric names it, or no catalogue is in use yet |
| `duplicate` | more than one metric names it; it counts as not linked and `candidates` lists them |
| `wrong_type` | one metric names it, but with another type than the key |

The app reports the keys that are not `linked`; what depends on them is not shown.

### Telemetry

A telemetry message is stored under its `time` (§4.1), or under the time of
arrival when the board has no clock (`time: null`) or its time is more than a
day from the server's. Every value becomes one row in `telemetry` by metric
name, whether or not the catalogue lists it: a number as sent, a bool as 1 or
0, an enum as its index. A `null` value (not known) is not stored in the time
series but is the metric's latest value, shown as unknown. Values that are
neither number, bool nor null, and names with control characters, are left out.
`metric_latest` keeps the newest value per metric.

**Counters** (§16.3) are stored as the count since boot, together with `boot`.
The history API returns a counter as a rate: the growth since the previous
point divided by the seconds between them. The first point after a new `boot`
has no rate (the counter started again from 0), and neither has a pair of
points with the same time or a count that went down within one boot.

### Events

An event needs `time`, `boot`, `seq` and `event`; its other fields are kept as
`data`. The server drops an event whose `boot` and `seq` it has already stored
(`device_events` has that as its primary key, so a repeat after a QoS 1 resend
or a restart of the server changes nothing); the same `seq` under another
`boot` is a different event.

### API

All routes need a session; every user sees every device.

| Route | Answer |
|---|---|
| `GET /api/devices` | `DeviceList`: name, first and last seen, `gateway_status`, `autopilot_mode`, `autopilot_stale` |
| `GET /api/devices/{name}` | `DeviceDetail`: both boards' `BoardState` (state as sent, `boot`, `protocol_supported`), `catalogues` (one per board: the revision in use, its parts and metrics, and the pending revision), `keys`, `latest` values; 404 for an unknown device |
| `GET /api/devices/{name}/history?board=&metric=` | `MetricHistory`; optional `from`, `to` (RFC 3339; default the hour before now), `limit` (default 2000, at most 10000; the newest are kept and `truncated` says so), `rate` (default `true` for a counter, `false` otherwise) |
| `GET /api/devices/{name}/events?limit=` | `DeviceEventList`, newest first (default 100, at most 1000) |

`board` is `gateway` or `autopilot`, because both can have a metric of the same
name (`system.cpu`). A metric name in a family (`usage.mqtt.up.autopilot/telemetry`)
goes in `metric` as it is; the history looks the kind up in the family's entry.

WebSocket requests (envelope as in [Wire protocol](#wire-protocol)):

| `op` | Fields | Answer (`data.kind`) |
|---|---|---|
| `devices` | | `devices`: a `DeviceList` |
| `device` | `name` | `device`: a `DeviceDetail` |
| `metric_history` | `device`, `board`, `metric`, optional `from`, `to`, `limit`, `rate` | `metric_history`: a `MetricHistory` |

Pushed to every open socket (no request):

| `type` | Fields | When |
|---|---|---|
| `device_changed` | `device`, `board` (null for the gateway status), `change` | `status`, `state`, `boot`, `catalogue` (the catalogue in use changed, so the keys may have), or `event`; the client loads the device again |
| `telemetry` | `device`, `board`, `time`, `boot`, `values` (`metric`, `value`) | every telemetry message stored, so a live view needs no polling |

## Mower commands

What the server sends the mower: commands, live-driving setpoints, monitor
streams and the correction caster's settings. The contract is wiki
[Mower-Protocol](Mower-Protocol) §5, §6.4, §8, §9, §13 and §15; this section
says what the server does with it. Code: `internal/mower/` (`command.go`, `drive.go`,
`monitor.go`, `ntrip.go`, the SQL in `store.go`), wire types in
`internal/api/command.go`. The server is the only publisher of commands. Path
planning and border recording logic are not here yet: the server sends
`path_start`, `record_start` and `record_stop` when a user asks, and does nothing
else with them.

### The command sender

A command gets an id (`c-` and 12 hex characters), is written to the `commands`
table in state `sent`, and is published on `<prefix>/<name>/<board>/cmd` with
QoS 1. The API answers at once; the outcome follows.

- **Acks.** The board's ack on `<board>/cmd/ack` moves the command: `accepted`
  (a long-running command is running; the resends stop), then `done` or `failed`
  (the final ack; `error`, `message` and `result` are kept). A final ack is final;
  an ack for another device or board, or for an id the server does not know, is
  ignored.
- **Resend.** No ack within 5 s: the same bytes go out again, with the same id,
  up to 3 times (4 sends in all, `attempts` says how many). Five seconds after the
  last resend the command is `unknown` with the error `no_ack`: the outcome is read
  from the board's state. An ack that arrives later still settles it.
- **New boot.** When a board's `boot` value changes, every open command of that
  board is `failed` with the error `board_restarted` (§5). The final ack of an
  update arrives after the restart, with the command id kept across it (§6.5), so
  a command failed this way still takes its own final ack.
- **Server restart.** Commands that were open when the server stopped are
  `unknown` with the error `server_restarted` when it starts.
- **Refused before sending.** The device must exist (404). The mower must not be
  offline (the gateway's retained status `offline`: 409). A board that reports a
  protocol this server does not support gets nothing but `ota` (409). The
  gateway's `restart` and `ota` are refused (409) only when the autopilot is known
  and not idle: with the board link up (the gateway state's `autopilot_link` is
  `up`, or not reported) its state must say `mode: idle`, and the reason names the
  mode. They are allowed when the gateway reports the link as not up (`down` or
  `incompatible`) or when no autopilot state was ever received, because then the
  autopilot cannot be working under the gateway's control. The autopilot's own
  restart and update are the board's to refuse (`wrong_mode`).
- **Parameters** are checked against §6.4 and §8 and refused (400) when missing,
  of the wrong type or not defined for the command; a command message is at most
  4096 bytes. `monitor_start` and `monitor_stop` are sent by the monitor, `ntrip_set`
  and `ntrip_clear` by the server itself: asking for them is a 400.

Every change of a command is pushed to the open sockets (`command`).

### API

All routes need a session (and an allowed `Origin` for the POST).

| Route | Answer |
|---|---|
| `POST /api/devices/{name}/commands` | body `CommandRequest`: `board` (`gateway` or `autopilot`), `cmd`, `params` (an object or null), `expires_in` (seconds, 1 to 3600, or null; the board refuses the command with `expired` after that). 202 with the `Command` in state `sent`; 400, 404, 409 as above |
| `GET /api/devices/{name}/commands?limit=` | `CommandList`, newest first (default 100, at most 1000) |
| `GET /api/devices/{name}/commands/{id}` | one `Command` |
| `GET /api/devices/{name}/monitor` | `MonitorStreams`: the streams the server keeps alive for the device |
| `GET /api/ntrip` | `NtripSettings`: whether a caster is set, host, port, mount point and user, and `password_set`; never the password |

Commands a user may send: gateway `ping`, `restart`, `ota` (`version`, optional
`file`, `size`), `autopilot_reset`; autopilot `stop`, `manual_start`,
`manual_stop`, `blade` (`on`), `follow` (`points` 1 to 100 of `[lat, lon]`,
optional `reverse`, optional `type`: `transit` (the default), `edge` or `fill`),
`speed_limit` (`limits`: one or more of `max`, `transit`, `edge`, `fill`,
`manual`, each a number of 0 or above in m/s, 0 meaning no limit, or `null` for
the firmware's default; any other name or value is a `400`, and the server sets
no upper bound), `record_start` (`session`, optional
`spacing`), `record_stop`, `path_start` (`path`, `size`, `sha256`, optional
`from_point`), `pause`, `resume`, `clear_fault`, `ota`, `restart`.

WebSocket requests (`op`):

| `op` | Fields | Answer (`data.kind`) |
|---|---|---|
| `drive` | `device`, `v`, `w` | none, unless it fails (an error response) |
| `monitor_watch` | `device`, `board`, `metrics`, `rate` | `monitor_watching`: a `MonitorWatching` (`session`, `state`, `budget`, `used`) |
| `monitor_unwatch` | `device`, `session` | `done` |

Pushed to every open socket:

| `type` | Fields | When |
|---|---|---|
| `command` | `command` | a command was created or changed |
| `monitor` | `stream`, `error`, `message` | a monitor stream changed state (`starting`, `running`, `failed`, `stopped`) or the board's budget changed |
| `monitor_samples` | `device`, `board`, `session`, `index`, `time`, `rate`, `metrics`, `samples` | the samples of a stream somebody watches |

A request that gets no response at all (`drive`) is the only exception to "one
response per request": at 10 Hz an answer to each setpoint is noise.

### Live driving

The browser sends `drive` with its setpoint `v` (m/s) and `w` (rad/s), as often
as it likes (every 100 to 200 ms while driving). The server publishes the latest
setpoint on `autopilot/drive` every 100 ms with QoS 0 as
`{"seq", "time", "v", "w"}`: `seq` grows by one per setpoint, `time` is the
server's clock. It falls silent 300 ms after the browser's last `drive`, and the
autopilot stops the motors on its own after 0.5 s without a setpoint (§9). The
server does not clamp `v` and `w`: it holds no constants about the hardware, and
the autopilot clamps. A device that does not exist is an error response.

### Monitor streams

`monitor_watch` asks for a fast stream of metrics of one board (§15). The
server checks the metrics and the rate against the board's catalogue in use (a
metric that does not exist, or a rate it does not offer: 400), picks a session id
(`m-…`), sends `monitor_start` with `hold` 15 and answers at once with the stream
in state `starting`; the board's ack turns it `running` (or `failed`, with the
board's error, for example `over_budget`) and arrives as a `monitor` push.

- **Only while watched.** The client sends `monitor_watch` again every 5 to 10 s
  while the chart is open; the same board, metrics and rate share one stream. While
  the last watch request is less than 15 s old, the server sends `monitor_start`
  again every 5 s with the same session and a new command id, which extends the
  stream. After that it sends `monitor_stop` and forgets the stream. A stream
  also ends with `monitor_unwatch`, which stops it for every client of it.
- **Samples** from `<board>/monitor` are relayed as `monitor_samples` while the
  stream is watched, and dropped otherwise. They are not stored.
- **Budget.** Every `monitor_start` ack reports `budget` and `used`, on success and
  on failure; the server keeps the last values per board and shows them in
  `MonitorWatching`, so the app can show what is left. The server does not compute
  the budget itself.
- The monitor commands are not stored in `commands`: they come every few seconds.
  They are resent, and fail with `no_ack`, like any command.

### Corrections (`ntrip_set`)

The NTRIP client runs on the gateway and keeps its settings across restarts, so
the server sends them once per gateway and again when they change (§13). The
settings are the server's environment: `NTRIP_HOST`, `NTRIP_PORT` (default 2101),
`NTRIP_MOUNTPOINT`, `NTRIP_USER` and `NTRIP_PASSWORD`, all four or none. The
password is a secret like `MQTT_PASSWORD`: it is read only from the environment,
goes to the gateway in `ntrip_set` and nowhere else. It is not written to the
database (the stored command has no `password`), not logged, not returned by the
API and not pushed; `config.NTRIP` prints without it.

The server decides when to send from the gateway's retained state, which arrives
whenever the gateway's link to the server comes up. It sends `ntrip_set` when it
has no fingerprint of acknowledged settings for the gateway, when the stored one
differs from the current settings (any field, the password included), or when the
gateway reports `ntrip: "off"` (it lost them). At most once per 30 s per gateway.
The fingerprint (table `ntrip_sent`) is stored when the gateway acks `done`; it is
an HMAC-SHA-256 keyed with `MQTT_PASSWORD`, so it does not reveal the password.
Settings removed from the environment send `ntrip_clear` to a gateway that has
them. A change of the settings is a change of the environment, so it takes
effect when the server starts again.

## Login and sessions

How the app logs people in. Code: `internal/auth/` and
`web/src/features/auth/`.

```
browser                                   rmx-server                       TimescaleDB
  │ POST /api/auth/login {user,pw}           │                                 │
  │ ───────────────────────────────────────▶ │ Argon2id check (slow, 19 MiB)   │
  │                                          │ token = 32 random bytes         │
  │                                          │ INSERT sessions(sha256(token))  │──▶
  │ ◀── Set-Cookie: __Host-app_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/
  │                                          │                                 │
  │ GET /api/auth/me  (the browser adds the cookie)                            │
  │ GET /ws + Upgrade (the cookie too)       │ look up sha256(cookie):         │
  │ ───────────────────────────────────────▶ │ exists, not idle, not expired?  │──▶
  │ ◀── 200 / 101 Switching Protocols, or 401                                  │
  │ POST /api/auth/logout                    │ DELETE the row                  │──▶
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
| `Path` | `/` | The app has its own host, `app.rmx.lt`, so the whole host is the app. The `__Host-` prefix requires `Path=/`. |
| Prefix | `__Host-` (`__Host-app_session`) | Browsers accept such a cookie only with `Secure`, from an HTTPS page, with `Path=/` and without `Domain=`. So plain HTTP can't set or overwrite it, and another host under `rmx.lt` can't plant a cookie with the same name that would be sent here. If a request still carries our cookie name twice, the server treats it as logged out rather than guess which one is real. |
| CSRF | SameSite **plus** an `Origin` check | SameSite works per *site* (all of `rmx.lt`), and not every browser enforces it. Every request that isn't GET/HEAD/OPTIONS, and every WebSocket handshake, must have an `Origin` from `ALLOWED_ORIGINS`, or it gets 403. The login too (no "log the victim into the attacker's account"). WebSockets matter most: CORS doesn't cover them, so without this any website could open one with the user's cookie ("cross-site WebSocket hijacking"). |
| Password guessing | in-memory backoff per username and per IP | 5 free failures per username (20 per IP), then 1 s, 2 s, 4 s … up to 15 min; while waiting, even the right password gets 429. Unknown usernames are checked against a dummy hash, so they take as long and get the same answer. A restart forgets the counters; several instances would need a shared store. |
| Client IP | last `X-Forwarded-For` entry, else the TCP peer | Caddy sets that header; the app's port is not published, so only Caddy reaches it. |
| Caching | `Cache-Control: no-store` behind the login | No copy of user data in a shared cache, or in the back button after logout. |

**What's public:** `/health` (only up/down and the version, for the
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

## Planning API

Where the web app keeps what users plan: their maps and their settings, per
user. Code: `internal/planning/`, wire types in `internal/api/planning.go`
(generated to `web/src/data/api/generated/`). All routes need a session;
another user's map answers 404, as if it did not exist.

**Names.** A **map** is one garden or site, drawn on the canvas. It has
**zones**: named parts of the map, such as "Front lawn", that own their drawn
shapes and, later, their settings (cut height and others). A zone's polygons
are its **areas**, each with a category:

| Category | Meaning |
|---|---|
| `mowing` | mow it |
| `no_go` | never enter: trees, beds, ponds, anything fixed the mower must avoid |
| `navigation` | drive through without mowing: paths between lawns, the way to the dock |

These follow other robot mower apps (Husqvarna: work area, stay-out zone,
transport path; Mammotion: task area, no-go zone, channel; OpenMowerNext:
operation, exclusion and navigation areas). In those apps a drawn no-go area
is how a fixed obstacle is mapped; "obstacle" means what the mower's sensors
find while driving.

| Route | Body → answer |
|---|---|
| `GET /api/maps` | → `MapList`: id, name, revision, area counts per category (over all zones), `updated_at`; newest change first |
| `POST /api/maps` | `MapCreate` {name, doc} → 201 `MapDetail` at revision 1 |
| `GET /api/maps/{id}` | → `MapDetail` {id, name, revision, updated_at, doc} |
| `PUT /api/maps/{id}` | `MapUpdate` {name, revision, doc} → `MapDetail` at revision + 1; 409 `conflict` when `revision` is not the stored one |
| `DELETE /api/maps/{id}` | → 204 |
| `GET /api/settings` | → `SettingList` {settings: [{key, value}]}, sorted by key |
| `PUT /api/settings/{key}` | `SettingValue` {value: any JSON but null} → 204 |
| `DELETE /api/settings/{key}` | → 204, also when the key was not set |

The type is `MapDetail`, not `Map`, so the generated TypeScript doesn't
shadow JavaScript's `Map`.

**One document per map.** The client loads and saves a map as a whole, so
its content is one JSON document (`MapDoc`): `zones` and `geo_anchor`
(WGS-84 of the canvas origin, or null). A zone is `{ id, name, areas }`; an
area is `{ id, category, vertices }`. A missing list comes back as an empty
array. The server refuses a document (400) without a zone, with a zone name
that is empty or longer than 100 characters after removing surrounding spaces,
with two zones of one id, with two areas of one id (area ids are unique in the
whole map, not per zone), with an area category other than the three above,
and over the limits below. Members a document stored by an earlier version
still has (format, type, coordinate system, headland, area `type`, `points`,
`layer_settings`) are ignored on read and dropped by the next save.

**Maps from before zones.** The first version of the document had `zones` as
the polygons themselves. Development data, so there is no conversion: the
migration `20261118000000_map_zones.sql` deletes every map whose first zone has
no `areas`. A map in the old format that still gets in (a restored backup) is
listed with zero counts, and the web app refuses to open it with a message on
Home; it can be deleted from its menu.

**Revisions instead of last-write-wins.** Every save names the revision it
started from. If another browser saved in between, the save is refused with
409. The web app then saves over the stored revision (see
[Web app](#web-app), "Saving"); another client may instead reload.

**Limits** (400 when exceeded): a name of 1 to 100 characters (surrounding
spaces removed), a body of at most 4 MiB, 5000 areas, 100 000 vertices,
a geo anchor inside
±90/±180. Setting keys match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, values are
at most 16 KiB of JSON, at most 100 settings per user.

## Web app

The web app in `web/` is the blade-terminal workbench, ported from
[jRmx0/blade-terminal](https://github.com/jRmx0/blade-terminal) at commit
`65d23b7` (rmx-server-app#51): draw a map (mowing areas and no-go areas) on a canvas, inspect it, and save it. It opens on the login form
when there is no session; after login the shell loads (see "The shell" below).
While logged in the
app keeps the WebSocket open; when it closes, the app asks `/api/auth/me`
whether the session still exists and shows the login form if not.

- **Data lives on the server.** Each user's maps and settings are stored by the
  [Planning API](#planning-api), so they follow the user to any browser. Code:
  `web/src/data/planning/` (the API client is `web/src/data/api/planning.ts`).
  The browser keeps no planning data; the IndexedDB database `blade-terminal`
  of earlier versions is deleted at login, without import. The UI and the code
  use the server's names: map, zone, area, mowing area, no-go area, and the
  area categories `mowing` and `no_go` as they are, with no translation
  ([rmx-server-app#82](https://github.com/rmx-lt/rmx-server-app/issues/82)).
  The web app can't draw navigation areas yet
  ([rmx-server-app#81](https://github.com/rmx-lt/rmx-server-app/issues/81)), so
  `src/data/planning/maps.ts` keeps a map's navigation areas, and the areas of
  zones it does not show, out of the canvas and writes them back unchanged on
  every save (renumbered if a drawn area took their id). The open map's zones
  and the active zone (the zone the canvas shows and drawing adds to; for now
  the first, and a map has one) are in `model/mapStore.ts`; the canvas holds the
  active zone's areas. A new map is created with one zone, "Zone 1".
- **Saving.** Everything is saved by itself; there is no save status, Save
  button, autosave switch or leave-page warning. A new map (New map on
  Home, Ctrl+Alt+N) is created on the server at once. After login the app
  opens the map opened last in this browser (its id is kept in `localStorage`,
  key `rmx:last-map`), or shows Home when there is none, it no longer exists or
  it can't be opened (the message is on Home, and the key is forgotten);
  nothing is created by itself. Duplicate in a map's menu on Home makes a copy
  ("name (copy)") and makes it the open map, and Home stays. A change is saved
  one second after the last one (a burst is one save): the whole map with the
  `revision` it was loaded or saved at (`web/src/data/planning/autosave.ts`,
  wired up in `features/canvas-editing/data/canvasBridge.ts`). A failed save is
  retried after 1 s, then 2, 4, 8 and at most every 15 s, and at once when the
  WebSocket opens again, so changes made while the server is down are sent when
  it is back. Before another map is opened or made, a waiting save is run first;
  if it fails the switch is refused. When the map was saved elsewhere in
  between (409 `conflict`), the client reads the stored revision and saves its
  own document over it: the user's change is never dropped, the other window's
  change to the same map is. The only state shown is the connection: "Server: live"
  while the WebSocket is open, "Server: offline" otherwise (bottom bar).
- **Settings.** UI preferences (unit of measure, floating panels) and the
  default geo anchor of new maps (`geoAnchor.default`) are per-user settings,
  read once per login.
- **Layers.** Users can't change styles. The widths of the area layers are
  constants (`LAYER_STYLE` in
  `web/src/config/canvas-editing/canvasConfig.ts`), the colours come from the
  theme (see "Name, logo and theme"), and the code decides what is
  visible: the map background when the map has a geo anchor, and the grid on the
  Grid map type (or when the map has no anchor, so the canvas is never bare).
  The background has three types: Satellite (ArcGIS World Imagery), Map (ArcGIS
  World Street Map), both from `server.arcgisonline.com`, no key, attribution
  shown in a strip over the full width of the canvas bottom, with the canvas controls above it (also on Grid; the controls sit 16px from the side edges, as far as from the strip) (the OpenStreetMap tile servers are not used: their usage
  policy rules out bulk loading), and Grid (no tiles, no request, only the
  grid). The Layers button in the bottom left corner of the canvas shows the type
  it switches to (a click toggles Satellite and Grid; from Map it goes to
  Satellite). Hovering or focusing it opens a separate card of tiles to its right (the three
  types and More; names under the pictures, no mark on the current type); the card stays open for 2 seconds after the cursor leaves. More
  opens a "Map details" panel that takes the place of the button and the card, with a "Map type" section; it
  closes only with its X or Escape and then the button returns. Map details marks the current type. The choice is the per-user setting `map.layer`
  (`satellite`, `street` or `empty`; any other value reads as satellite). Tiles load smoothly:
  a tile that has not arrived yet is drawn from the cached tiles of the zoom
  levels around it (scaled), the image cache holds at most 600 tiles, and loads
  nobody needs any more (a fast zoom or pan) are cancelled. A new map gets the
  user's default anchor (none when unset: no background). The anchor of the open
  map is set in the Settings modal, Map defaults: "Use my location" (the
  message names the real reason when the browser refuses: permission blocked,
  position unavailable, timeout, or a page that is not https), "Use my default"
  or typed coordinates. Moving
  the anchor keeps the zones at their canvas coordinates: they move with it over
  the earth.
  The grid has two levels (a stronger line every 5 minor cells; the cell size
  follows the zoom through `pickGridLevel`, from 0.04 to 40 000 map
  units) and fades out towards the edges. The zoom goes up to 200 (a 20 cm
  line is 40 px wide when the map unit is metres); the wheel (Alt + wheel),
  the buttons and the shortcuts animate to their target, anchored on the cursor
  (the canvas centre for buttons and shortcuts), and a new step retargets it.
  Fit and Home animate the same way (position and scale), and a wheel step or a
  new action retargets them. Pan and zoom never run together: a pan drag
  (`panning` in `canvasViewStore`) stops a running animation, and wheel, buttons,
  shortcuts, Fit and Home do nothing until it ends. In select mode an area brightens its fill on hover
  and more when selected; the vertices of the selected area are small squares
  filled in the area colour (a thin ring in that colour on hover, a thicker one when selected),
  and an edge midpoint is a plain ring that shows only when the cursor is near.
  Handle sizes are screen pixels, constant at every zoom.
  The bottom bar of the workbench shows a scale bar as long as one grid cell,
  labelled in the map's unit, on every map type.
  The map has no format, type, coordinate system, headland, route points or
  zone type, and there is no map generator, vertex modifier or XML import and
  export. The mower owns its dimensions, so the headland comes back when it
  reports them
  ([rmx-server-app#100](https://github.com/rmx-lt/rmx-server-app/issues/100));
  `web/src/features/canvas-editing/utils/headlandGeometry.ts` is kept for that,
  unused for now.
- **Name, logo and theme.** The client is called **RMX** (page title, header,
  login form); the repository, Go module and wiki keep their names. The logo is
  the RMX mark (`web/src/assets/rmx-logo.png`, shown with rounded corners like
  the organization avatar; `rmx-favicon.png` is the rounded favicon). Colours
  are named tokens defined once in `web/src/styles/index.css` with Tailwind's
  `@theme` (utilities `bg-surface`, `text-fg`, `border-line`, `bg-accent` and so
  on; the light set is the `@theme` block, the dark set overrides it under
  `data-theme="dark"`). Components use the token names, never fixed greys or
  hex values. Tokens: `page` (app background, canvas), `surface` (panels, bars,
  menus, modals), `raised`, `hover`, `pressed`, `line`, `line-strong`, `fg`,
  `muted`, `faint` (placeholders and disabled only; below 4.5:1), `accent`,
  `accent-hover`, `on-accent`, `danger`, `danger-soft`, `ok`, `warn`, `overlay`,
  and `canvas-*` (grid, mowing and no-go stroke and fill, handles). Konva needs
  concrete colours, so the canvas layers read the `canvas-*` variables through
  `useCanvasColors` (`web/src/hooks/useTheme.ts`) and redraw when the theme
  changes, with no reload. The default follows the system
  (`prefers-color-scheme`); the user's choice (system, dark, light) is kept in
  the browser (`localStorage` key `rmx:theme`, no server involved), and a small
  script in `public/index.html` applies it before first paint, so there is no
  flash. The choice is made in the settings modal, page
  Appearance.
- **The shell.** The structure of the Claude desktop app, with the canvas in
  place of the chat. The app shows one of two pages, held by one store value
  (`model/pageStore.ts`, `home` or `workbench`; there is no router), each with
  a side panel on the left and the bottom bar under everything:
  - **Bottom bar** (`layouts/bottom-bar/`): a thin bar across the full width,
    on both pages. It holds the server status, "Server: live" or "Server:
    offline" (tooltip: "Connected to the server" / "No connection to the server"), and nothing else. There is no "reconnecting": the socket's retry
    cycle would only make it flicker.
  - **Home** (`layouts/home-window/`, modelled on SolidCraft's start page).
    Side panel: logo and name, "Back to *map name*" with its key hint (Esc;
    only when a map is open), New map (Ctrl+Alt+N), and at the bottom the
    account menu and the settings button. Work area: a New map card (map icon with
    a plus, accent border) and the
    list of maps, newest change first, with the time of the last change; the
    open map is highlighted, and stronger when hovered. A click opens a map in the
    workbench; its menu has Rename (in place), Duplicate and Delete (a
    confirmation first). Deleting the open map leaves no map open and the user
    on Home. The actions are those in `features/map-manager/data/mapBridge.ts`,
    the same code as before the move.
  - **Workbench** (`layouts/workbench-window/`):
    - **Side panel** (left, collapsible; Ctrl+Alt+C): no logo or name; it
      starts with the close button at the left, in the place of the top bar's
      open button, so the toggle does not move. A Home button, the mode switch, then the **Zones** list of the open map (in
      every mode): the active zone is marked, a zone is renamed from its menu
      (Rename) or by double click, in place, and the change is saved by the
      autosave. There is no add, delete or reorder of zones yet. Then a device spot (placeholder until
      [rmx-server-app#93](https://github.com/rmx-lt/rmx-server-app/issues/93)),
      and at the bottom the account menu and the settings button. It has no map
      list and no New map. **Both panels are resizable** (from 768 px, from
      1024 px for the right one): drag the inner edge between 224 and 480 px; the
      width is kept in `localStorage` (`rmx:panel-widths`). At the minimum width,
      dragging on past half of it closes the panel, and in the same drag,
      coming back past that point opens it again. The strip is a 2 px accent line on
      the panel edge, shown on hover and during the whole drag (the cursor stays
      the resize cursor until release, also after the panel closed). Opening,
      closing or resizing a panel only changes the size of the canvas view; the
      canvas keeps what is on screen where it is (the view is shifted back when
      the left edge moves, in the same frame: `useCanvasSize` commits React and
      draws the stage synchronously in its `ResizeObserver` callback). The toggle buttons use one icon per panel
      (`PanelLeft`, `PanelRight`) whether it is open or closed.
    - **Top bar:** over the canvas and the right panel, up to the right edge,
      with a line under it. The open map's name is at the left (click to
      rename); its edit box is as wide as the name, between one letter and a
      maximum width (a hidden copy of the text sets it, because CSS
      `field-sizing` is missing in Firefox), and a long name is cut with an
      ellipsis when not edited. The right panel toggle is at the right.
    - **Canvas** in the middle, with the tool strip floating at the bottom
      middle (a rounded strip) and the view controls (zoom in, zoom out, fit
      all areas, home) at the bottom right in every mode.
    - **Right panel** (collapsible; Ctrl+Alt+I) with the tabs Details (under
      the active zone's name: its area counts, area to mow and perimeter; for a
      selected area its category and gross and net area; no vertex data) and Monitor (a
      placeholder).
  - **Modals** (`components/ui/Modal.tsx`) fade the backdrop and scale and fade
    the panel in step (150 ms), on open and on close.
  - **Settings modal**: a page list on the left, on both pages. Account (user
    name, log out, log out everywhere), Appearance (theme, unit of measure) and
    Map defaults (the default geo anchor of new maps, and the open map's own).
    Later pages (users, NTRIP, devices, shortcuts) come with their own issues.
  - **Tooltips** (`components/tooltip/Tooltip.tsx`, no dependency): one
    component for every control that needs one, a small dark box with the label
    and, where there is one, the shortcut in a muted tone. It shows after a
    short hover and at once on keyboard focus, hides on Escape and on press,
    stays inside the window, and is linked to its control with
    `aria-describedby`. Shortcuts come from
    `config/shortcut-manager/workbenchShortcutsConfig.ts`, not typed again. No
    native `title` attributes are used. UI text is not selectable (`select-none` on
    `body` in `index.css`); inputs, text areas and `role="alert"` messages opt back
    in. The text selection colour is the browser's.
  - Under 768 px the workbench side panel, and under 1024 px the right panel,
    float over the canvas instead of sitting beside it (a tap outside closes
    them); opening one closes the other on a narrow screen, and both start
    closed there. On Home the side panel stacks above the work area under 768 px.
  - Modals, menus, tabs and selects are Headless UI (focus trap, Escape,
    arrow keys); icons are `lucide-react`. The panel and tool state lives in
    `features/ui-manager/stores/uiShellStore.ts`.
- **Modes.** Plan, Drive and Mow, switched in the side panel; one store
  (`model/modeStore.ts`) holds the mode, and `config/modes/modes.ts` says what
  each shows. The mode decides the tool strip, the visible canvas layers and the
  right panel's content (Details while planning, Monitor in the other two);
  there is no separate view switch, and users can't switch layers.

  | Mode | Tool strip | Layers |
  |---|---|---|
  | Plan | select (S), mowing area (Z), no-go area (O), delete (D), undo (Ctrl+Z), redo (Ctrl+Y) | areas |
  | Drive | driving control, mower mode, blade, stop, record border, rewind, save as area | areas, mower, draft border |
  | Mow | plan job, start, pause, resume, go to point, follow path | areas, job path, progress, mower |

  Plan works fully; the tools and their shortcuts work in Plan mode only, and
  leaving Plan puts the active tool away. Drive and Mow are the shell only:
  their tools are inert (they stay in the Tab order and say in a tooltip what
  they will do) and their layers have nothing to draw yet. The behaviour comes
  with [rmx-server-app#94](https://github.com/rmx-lt/rmx-server-app/issues/94),
  [#105](https://github.com/rmx-lt/rmx-server-app/issues/105) and
  [#106](https://github.com/rmx-lt/rmx-server-app/issues/106).
- **No algorithm providers.** The client does not connect to external algorithm
  providers: there is no provider, compute, debug, benchmark or performance
  monitor feature, and the only `fetch` calls go to the app's own
  API.

## Repository layout

The layout keeps boundaries checked by tests and lint, not by convention, so
new domains and the ported blade-terminal client fit without a later move.

### Go

```
go.mod, go.sum          Go module (go 1.26), staticcheck pinned as a tool
cmd/rmx-server/         main: serve, healthcheck, user commands (imports app only)
cmd/gen-ts/             TypeScript generator; reads internal/api only
cmd/devsim/             simulated mower (both boards) for local development (config for .env, paho)
dev/                    local broker config; run.ps1 starts the whole local environment
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
  auth/ transfer/       domains (planning/ and mower/ too), files:
                          service.go, store.go (all SQL, takes db.DBTX), http.go, ws.go,
                          mqtt.go (device payloads + topic suffixes), as far as the domain needs them
                          (transfer/ serves chunks; mower/ also holds the command sender,
                          the drive and monitor streams and the caster settings)
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
  `mower.DeviceLookup`), satisfied by the other domain and injected by `app`.
- Only `app` and `integration` import everything. `cmd/rmx-server` imports
  only `app`, `cmd/gen-ts` only `api`, `cmd/devsim` only `config` (for `.env`).
- Each table has one owning domain; foreign keys to `devices` / `users` are
  fine, cross-domain queries are not. A cross-domain write uses `db.InTx`
  and passes the transaction to both stores. Events are published after the
  commit; state that must survive (such as a command's ack or expiry) lives
  in the database, not on the bus.
- Third-party fences: paho only in `mqtt`, coder/websocket only in `ws`, pgx
  (and goose) only in `db` and in the domains' `store.go` files. The
  integration tests are exempt: they play the browser and the devices. `cmd/devsim`
  may use paho too: it plays a device.

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
    app/                main, App, login gate, WebSocket keep-alive
    layouts/            the shell: home-window/, workbench-window/ (side-panel, top-bar, canvas, right-panel, settings), bottom-bar/, account/; composes features
    features/<name>/    {components,hooks,stores,data,utils,types}; auth + the blade-terminal features
    model/              state several features share (the open map, the map list, the page: Home or workbench, the connection)
    data/               the functions features call
      api/              http + WebSocket clients; generated/ (cmd/gen-ts output, committed)
      planning/         maps (load, save, conversion to the wire format), settings
    components/         generic widgets only (ui/ Button and Modal, tooltip/, tool-strip/, settings-panel/ rows, inspector-panel/ rows and tabs, confirmation modal)
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
  the rest imports the types `data/api` exports.
- No `index.ts` re-export files; imports use the `@/` alias; tests sit in
  `__tests__/` next to the code.
- When data moves between the browser and the server, only `data/` changes.

The React Compiler rules of eslint-plugin-react-hooks are errors too: derive
state instead of syncing it in an effect (or adjust it during render when a
prop changes), and write `ref.current` in an effect, never during render.

### Other files

```
compose.dev.yaml, dev/mosquitto/  local/CI stack: TimescaleDB + Mosquitto
Dockerfile                        multi-stage: bun build + go build → distroless/static
.github/                          CI workflow, Dependabot
```

## Local development

You need Docker Desktop, Go (the version in `go.mod`), and Bun. No Node or npm.

**One command** (PowerShell, from the repo):

```powershell
dev\run.ps1             # stack + Go server + web dev server + simulated mower
dev\run.ps1 -NoSim      # without the simulated mower
dev\run.ps1 -SimSet fix=rtk_float,drop-acks=2   # start it with switches set (below)
dev\run.ps1 -ResetDb    # drop the dev database first (fresh migrations)
```

Then open <http://localhost:3000/> and log in as `DEV_USER` / `DEV_PASSWORD`
from `.env` (default `dev` / `dev-password-123`). The script:

- creates `.env` from `.env.example` when it is missing;
- refuses to start when port 8080 or 3000 is taken (a leftover server would
  answer instead), and names the process;
- starts TimescaleDB + Mosquitto (`compose.dev.yaml`; they keep running after
  Ctrl+C, stop them with `docker compose -f compose.dev.yaml down`);
- builds `rmx-server` and `devsim` into `.dev/` (gitignored), creates the dev
  login or resets its password to `DEV_PASSWORD`;
- runs the web dev server (hot reload), the server and the simulated mower in
  one terminal. On every saved `*.go`, `migrations/*.sql`, `go.mod`, `go.sum` or
  `.env` it rebuilds and restarts the server and the mower; a build error
  waits for the next save. Ctrl+C stops all three;
- sets `FIRMWARE_DIR=dev/firmware` (with `gateway/` and `autopilot/` below it,
  gitignored) when `.env` sets none: drop any `<version>.bin` into the board's
  subdirectory.


**Simulated mower** (`cmd/devsim`). Both boards of a mower on the local
broker, written from wiki [Mower-Protocol](Mower-Protocol) (not from firmware
or server code), so a server and an app built against it work with the real
mower. It implements version 0.1 of the contract. The UART between the boards
(§14) is not simulated: the two boards talk inside the program, and the gateway
still counts and relays the autopilot's topics as it would.

- **Connection.** Logs in as `test-device`, client id `<name>` (default
  `mower-sim`, `DEVSIM_NAME` or `-name`), keep-alive 15 s. `gateway/status` is
  `online` after every connect, with the last will `offline`. State and
  catalogues are published when the server link is up (§4.2): the broker
  connection works **and** the retained `mower/status/server` says `online`, so
  with no server running only the status appears. A server that stops or
  crashes counts as a lost link too.
- **Gateway** (§6, §12, §15, §16): retained state (`autopilot_link`, `ntrip`,
  firmware, partition), telemetry every 60 s (`-gateway-period` changes it, and
  the catalogue says so) with signal, load, link counters and the data-usage
  counters, counted per topic as whole MQTT packets; the commands `ping`,
  `restart`, `ota`, `ntrip_set`, `ntrip_clear`, `autopilot_reset`,
  `monitor_start` and `monitor_stop`, with the acks, error codes and the
  2-minute memory of command ids of §5; monitor streams with the budget of 100
  values per second. `ota` pulls `<version>.bin` over `gateway/fw/…` in
  4096-byte chunks (one request open, a new one after 10 s, five retries),
  checks size, SHA-256 and the version of an ESP-IDF image (any other file is
  accepted: there is no signature check), restarts into it and sends the final
  ack when the new image has reached the server. Reliable messages from the
  autopilot are held while the connection is down (60 s, 64 KB).
- **Autopilot** (§7 to §11): the state machine of §8 (every command in every
  mode, `wrong_mode` otherwise), retained state, telemetry at the periods of its
  catalogue (at least 10 s in `idle`) with every key of §16.4 linked, events
  with `boot` and `seq`, live driving on `autopilot/drive` (the setpoint rules
  and the 0.5 s timeout of §9), border recording in batches (§10), `follow`
  (`reverse`, `type`; `transit` when it is absent, `bad_request` for an unknown
  type), and paths: `path_start` downloads `<path>.json` over
  `autopilot/path/…`, checks size and SHA-256, drives to the start with the
  blade off and follows the segments, the blade on for `edge` and `fill` and off
  for `transit` (a segment with another type ends the path with `bad_path`); `path.point` counts the points reached, `path.points` is the length of the file, and
  `from_point` continues. Pauses for command, link or fix (§7.1), faults, `ota`,
  and monitor streams with the budget of 400 values per second.
- **Speed limits** (§7.1, §8): `speed_limit` is allowed in every mode and applies
  at once, to a running path (each segment is driven at the limit of its type)
  and to live driving (`v` is limited by `manual` and `max`, both ways). The
  speed is never above the limit of the type, nor above `max`; a limit of 0 is
  no limit, and with `max` at 0 as well the mower uses its top speed, 0.6 m/s
  (the one top speed of the simulator, also the ceiling for larger limits). The
  firmware defaults, which `null` returns to: `max` 0.6, `transit` 0.6, `edge`
  0.3, `fill` 0.5, `manual` 0.6 m/s. The limits are reported in the state, kept
  with the boot counters (so they survive a restart), and the ack's `result` is
  the object as it now is.
- **Motion model.** A differential drive following the live setpoints or the
  path: up to 0.6 m/s with acceleration limits, a heading that is only reported
  while moving (one antenna), a position around a fixed origin (54.687157,
  25.279652) in degrees with 8 decimals, a battery that drains with the load
  (150 Wh), and voltage, current and power that follow the load. The blade
  spins up and down.
- **Boot counters** and the running firmware are kept in
  `.dev/devsim-<name>.json`, so restarting devsim is a reboot of the mower:
  `boot` grows and counters start again; the speed limits stay. `-state -` keeps them in memory;
  delete the file to start from boot 1.
- **Not simulated:** the board link frames, the NTRIP connection itself (its
  states and byte counts are), the fix following the corrections (it follows
  the `fix` switch, default `rtk_fixed`), signatures of firmware images.

**Switches** provoke the edge cases. Set them at start with `-set name=value`
(`dev\run.ps1 -SimSet`), or on the running mower with
`go run ./cmd/devsim ctl <name> <value>` (the control endpoint listens on
`127.0.0.1:18090`; `-control` changes it):

| Switch | Does |
|---|---|
| `drop-acks N` | the next N acks of either board are not sent (lost acks); the server's repeat gets the remembered ack |
| `link down` / `link up` | the gateway is cut off from the server: `gateway/status` `offline`, nothing sent or received, reliable messages held; after 10 s the autopilot treats the link as lost |
| `board-link down` / `up` | the UART between the boards is cut: `autopilot_link` goes `down` after 3 s, commands to the autopilot are lost, and the autopilot loses the server link |
| `fix none`, `single`, `dgps`, `rtk_float`, `rtk_fixed` | fix loss: a path pauses after 3 s, recording takes no points below `rtk_float` |
| `fault motor_stall`, `blade_stall`, `battery_low`, `internal`, or `fault none` | the autopilot detects a fault; `clear_fault` fails while the cause is there |
| `battery <pct>` | sets the battery level (the warning event at 15, the `battery_low` fault at 8) |
| `signal <dBm>` | the modem's signal; an `ota` below -105 is refused with `low_signal` |
| `ota-rollback on` | the next update does not confirm: the old image runs again, final ack `rolled_back` |
| `ntrip ok` or `error` | the NTRIP client's state |

`go run ./cmd/devsim send [-board gateway|autopilot] <cmd> [key=value ...]`
publishes a command as the `app` login, standing in for the server, and prints
the acks up to the final one (a value is JSON when it parses as JSON):

```powershell
go run ./cmd/devsim send ping
go run ./cmd/devsim send -board autopilot manual_start
go run ./cmd/devsim send -board autopilot follow 'points=[[54.68722,25.27965]]' type=edge
go run ./cmd/devsim send -board autopilot speed_limit 'limits={"edge":0.2,"max":null}'
go run ./cmd/devsim ctl fix rtk_float
go run ./cmd/devsim -name mower-02                     # a second mower
```

The server stores what the mower reports ([Mower ingest](#mower-ingest)),
sends commands and live-driving setpoints and serves chunk transfer
([Mower commands](#mower-commands)): `POST /api/devices/<name>/commands` with
`{"board":"gateway","cmd":"ping"}` reaches the simulated mower and its ack comes
back in the command's state. A gateway `ota` needs `<version>.bin` in
`dev/firmware/gateway/` (the autopilot's in `dev/firmware/autopilot/`), a path
a row in the `paths` table (`transfer.StorePath`). `devsim send` and the tests
([Tests and checks](#tests-and-checks)) play the server's part without it.

The real board connects only to the VPS broker (port 8884, client
certificate), so testing with it means a production deploy.

**By hand**, the same steps one by one:

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
<http://localhost:3000/> and log in; the workbench loads:

```powershell
go run ./cmd/rmx-server create-user dev     # any password of 12+ characters
```

To try MQTT like a device, use any MQTT client on `127.0.0.1:11883` as
`test-device` with the `TEST_DEVICE_PASSWORD` from `.env`
(`test-device-dev`), publishing to `mower/<name>/gateway/fw/req` (needs
`FIRMWARE_DIR`), watching the server's commands on `mower/<name>/gateway/cmd`, or watching `mower/status/server`.

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
`bunfig.toml`). The same server proxies `/api/*`, `/health`,
and the `/ws` WebSocket to rmx-server (passing
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

Then open <http://localhost:8080/>.

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
`app_test.go`, `auth_test.go`, `commands_test.go`, `mower_test.go`, `planning_test.go`, `transfer_test.go`, `devsim_path_test.go`) start the real
server on a random port; each test creates a fresh migrated database, and uses
its own MQTT topic prefix, so they run in parallel. They cover the WebSocket
ping, chunk transfer (a path file from the `paths` table and firmware images side by side, a path id that is not in the table, every chunk
checked against the file's SHA-256, the three sets kept apart), the commands
(an ack, the resend of a lost ack after 5 s with the same id, open commands
failed by a new boot, a gateway restart and ota refused while the autopilot is in a path, allowed with the board link down or the autopilot idle),
live driving, a monitor stream that runs only while watched, the caster settings
sent once and on change (the password only on the wire), health, that the records routes and
tables are gone, the retained server status and graceful shutdown, and the
login: wrong
password and unknown user, protected routes (REST, WebSocket)
without, with a forged and with a duplicated cookie, expired and idle
sessions, logout and "log out everywhere", password change, session
fixation, foreign `Origin`s (REST, login, WebSocket) and the rate limit; and
the planning API: a map's create/read/update/delete, area counts per
category, the checks on zones (at least one, name length, unique ids), the revision conflict, invalid input, that users can't see each
other's maps, and settings; and the mower domain: a simulated gateway publishes
state, catalogues, telemetry and events, and the API and WebSocket show the
device, its keys, latest values, the history of a gauge and of a counter across
a restart, an incomplete catalogue that is not used, duplicate events that are
dropped, and an autopilot state that is out of date.

The simulated mower has its own tests in `cmd/devsim`. The unit tests run both
boards on a fake clock and play the server over the same topics: the state
machine of [Mower-Protocol](Mower-Protocol) §8 (every command in every mode),
the command id memory and lost acks, live driving and its 0.5 s timeout,
recording, paths with chunk download and retry, pauses and faults, monitor
streams and their budget, and the catalogues checked against §16.4 and §16.5.
`e2e_integration_test.go` (in the integration run) starts devsim against the
compose Mosquitto on a private topic prefix and plays the server: retained
`mower/status/server`, commands and repeated ids, driving, recording, a path
and a gateway update served over chunk transfer, and the switches. The integration run also builds devsim and runs it against the
real server: a path stored in the table is downloaded in chunks and followed,
and a path with all three segment types is followed with the blade on only for
`edge` and `fill`, while a `speed_limit` sent during the path changes the speed
at once and shows in the state (`devsim_path_test.go`).

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
- `HEALTHCHECK` built in (`/app/rmx-server healthcheck` → `GET /health`).
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
| `ALLOWED_ORIGINS` | **yes** | `https://app.rmx.lt` | comma-separated origins of the page. Others can't log in, change data or open the WebSocket (403). The server doesn't start without it |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error`. The Rust version's `RUST_LOG` is ignored |
| `BIND_ADDR` | no | `0.0.0.0:8080` | already set in the image |
| `MQTT_CLIENT_ID` | no | `rmx-server` | must be unique on the broker |
| `MQTT_TOPIC_PREFIX` | no | `mower` | |
| `DB_MAX_CONNECTIONS` | no | `5` | |
| `STATIC_DIR` | no | `/app/static` | already set in the image |
| `FIRMWARE_DIR` | no | `/firmware` | firmware images in the subdirectories `gateway/` and `autopilot/` (`<version>.bin`). Unset: no firmware is served. See [Firmware over MQTT](#firmware-over-mqtt) |
| `NTRIP_HOST`, `NTRIP_MOUNTPOINT`, `NTRIP_USER`, `NTRIP_PASSWORD` | no | (secret, server-side `.env`) | the caster the server tells the gateways to use; all four or none. The password is never logged or returned. `NTRIP_PORT` defaults to `2101`. See [Mower commands](#mower-commands) |

**Database:** TimescaleDB on Postgres 17 (`timescale/timescaledb:2.30.2-pg17`
or newer 2.x). The first migration runs `CREATE EXTENSION IF NOT EXISTS
timescaledb`, so the database user must own the database and either be a
superuser (the image's `POSTGRES_USER` is) or the extension must already exist.

**Routes the app serves itself.** The app has its own host, `https://app.rmx.lt/`,
and its routes start at the root: Caddy proxies every path of that host as-is,
with no prefix to add or strip. The app does its own login, so Caddy
needs no `basic_auth` in front of it:

| Path | Login | What |
|---|---|---|
| `/` and every path not listed below | public | the client (static files, `index.html` fallback); it shows the login form |
| `/api/auth/login`, `/api/auth/logout` | public | login, logout |
| `/health` | public | `{"status":"ok","db":true,"mqtt":true,"version":"0.1.0"}`, 200 or 503 |
| `/api/auth/me`, `/api/auth/logout-all`, `/api/maps…`, `/api/settings…` | session | REST |
| other `/api/…` | public | 404 |
| `/ws` | session | WebSocket (Caddy proxies upgrades by default) |

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
It checks the tag, pulls the image, restarts `app`, waits until the container
is healthy (the image's `healthcheck`, `GET /health`), and rolls back to the previous tag if the new one isn't
healthy (the job then fails).

Repository secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (the private key),
`DEPLOY_KNOWN_HOSTS` (the VPS's ed25519 host-key line, pinned). Rotating the
key is described on the wiki page [Server-Infra](Server-Infra) (§10).

## License

[Apache-2.0](https://github.com/rmx-lt/rmx-server-app/blob/development/LICENSE).
