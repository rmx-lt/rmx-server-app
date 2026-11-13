# syntax=docker/dockerfile:1
#
# rmx-server image: the Go binary plus the built client, nothing else.
#   docker build -t rmx-server-app .
# Bun is only a build tool here; the runtime image has no Bun, shell or package manager.

# ---- 1. Client: bun build -> /client/dist ---------------------------------
FROM oven/bun:1.4.3 AS client
WORKDIR /client
COPY client/package.json client/bun.lock ./
RUN bun install --frozen-lockfile
COPY client/ ./
RUN bun run build

# ---- 2. Server: a static Go binary ------------------------------------------
# The Go version must match the go directive in go.mod.
FROM golang:1.27.2-trixie AS server
WORKDIR /src
# Dependencies first, so this layer is cached until go.mod or go.sum change.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
# No cgo: the binary runs on the static distroless image. -trimpath and
# -s -w keep it small.
ARG VERSION=0.1.0
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X github.com/rmx-lt/rmx-server-app/internal/server.Version=${VERSION}" \
    -o /out/rmx-server ./cmd/rmx-server

# ---- 3. Runtime: distroless (CA certs, no libc), runs as uid 65532 ---------
FROM gcr.io/distroless/static-debian13:nonroot
LABEL org.opencontainers.image.source="https://github.com/rmx-lt/rmx-server-app" \
      org.opencontainers.image.description="Blade of Grass server (HTTPS, WSS and MQTT)" \
      org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
COPY --from=server /out/rmx-server /app/rmx-server
COPY --from=client /client/dist /app/static
# The app container runs with a 64 MB memory limit and a password check needs 19 MiB:
# a soft limit makes the Go garbage collector give memory back before the
# container is killed.
ENV BIND_ADDR=0.0.0.0:8080 \
    STATIC_DIR=/app/static \
    GOMEMLIMIT=40MiB
USER nonroot
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/rmx-server", "healthcheck"]
ENTRYPOINT ["/app/rmx-server"]
