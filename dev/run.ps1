# Local development in one command (PowerShell, from anywhere in the repo):
#
#   dev\run.ps1             # stack + Go server (restarts on save) + web dev server + simulated mower
#   dev\run.ps1 -NoSim      # without the simulated mower
#   dev\run.ps1 -SimSet fix=rtk_float,drop-acks=2   # start it with switches set
#   dev\run.ps1 -ResetDb    # drop the dev database first (fresh migrations, new dev login)
#
# Then open http://localhost:3000/ and log in with DEV_USER / DEV_PASSWORD
# from .env (default dev / dev-password-123). Ctrl+C stops the Go server, the
# web dev server and the simulated mower (flip its switches while it runs with
# `go run ./cmd/devsim ctl fix none`); the compose stack keeps running
# (docker compose -f compose.dev.yaml down to stop it).
#
# Needs Docker Desktop, Go and Bun (wiki Server-App, "Local development").
param(
    [switch]$NoSim,
    [switch]$ResetDb,
    [string]$SimName = '',
    # Switches for the simulated mower at start: name=value (wiki Server-App, Local development).
    [string[]]$SimSet = @()
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

function Say([string]$msg) { Write-Host "[dev] $msg" -ForegroundColor Cyan }

# --- settings -----------------------------------------------------------------
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Say 'created .env from .env.example'
}
# Values for this script from .env; the Go programs read .env themselves.
$dotenv = @{}
foreach ($line in Get-Content .env) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $dotenv[$Matches[1]] = $Matches[2].Trim('"', "'") }
}
$devUser = if ($dotenv.DEV_USER) { $dotenv.DEV_USER } else { 'dev' }
$devPassword = if ($dotenv.DEV_PASSWORD) { $dotenv.DEV_PASSWORD } else { 'dev-password-123' }
if (-not $SimName) { $SimName = if ($dotenv.DEVSIM_NAME) { $dotenv.DEVSIM_NAME } else { 'mower-sim' } }
# Firmware (gateway/ and autopilot/ below) and job files the server serves to the simulated mower.
if (-not $dotenv.FIRMWARE_DIR -and -not $env:FIRMWARE_DIR) { $env:FIRMWARE_DIR = 'dev/firmware' }
if (-not $dotenv.JOB_DIR -and -not $env:JOB_DIR) { $env:JOB_DIR = 'dev/jobs' }
New-Item -ItemType Directory -Force -Path dev/firmware/gateway, dev/firmware/autopilot, dev/jobs, .dev | Out-Null

# --- ports --------------------------------------------------------------------
# A leftover server or web dev server on these ports would answer instead of
# ours, so refuse to start.
$serverPort = if ($dotenv.BIND_ADDR -match ':(\d+)$') { [int]$Matches[1] } else { 8080 }
foreach ($port in $serverPort, 3000) {
    $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($busy) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy.OwningProcess)" -ErrorAction SilentlyContinue
        throw "port $port is in use by pid $($busy.OwningProcess) ($($owner.CommandLine)). Stop it (Stop-Process -Id $($busy.OwningProcess)) and run again."
    }
}

# --- database and broker ------------------------------------------------------
if ($ResetDb) {
    Say 'dropping the dev database (compose down -v)'
    docker compose -f compose.dev.yaml down -v
    if ($LASTEXITCODE -ne 0) { throw 'compose down failed' }
}
Say 'starting TimescaleDB + Mosquitto'
docker compose -f compose.dev.yaml up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'compose up failed: is Docker Desktop running?' }

# --- Go programs --------------------------------------------------------------
$server = Join-Path $root '.dev/rmx-server.exe'
$sim = Join-Path $root '.dev/devsim.exe'
function Build {
    go build -o $server ./cmd/rmx-server
    if ($LASTEXITCODE -ne 0) { return $false }
    go build -o $sim ./cmd/devsim
    return $LASTEXITCODE -eq 0
}
# Newest write time of anything the Go side is built from.
function SourceStamp {
    $files = @(Get-ChildItem -Recurse -File -Path cmd, internal, migrations -Include *.go, *.sql -ErrorAction SilentlyContinue) +
        @(Get-Item go.mod, go.sum, .env -ErrorAction SilentlyContinue)
    ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
}
function Stop-Tree($proc) {
    if ($proc -and -not $proc.HasExited) { taskkill /T /F /PID $proc.Id 2>&1 | Out-Null }
}

Say 'building'
if (-not (Build)) { throw 'go build failed' }

# Dev login: create it, or reset its password to DEV_PASSWORD when it exists.
$devPassword | & $server create-user $devUser 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { $devPassword | & $server set-password $devUser 2>&1 | Out-Null }
if ($LASTEXITCODE -ne 0) { throw "could not create the dev login $devUser (DEV_PASSWORD needs 12+ characters)" }
Say "login: $devUser (password from DEV_PASSWORD in .env, default dev-password-123)"

# --- web dev server -----------------------------------------------------------
if (-not (Test-Path web/node_modules)) {
    Say 'bun install'
    Push-Location web; bun install; Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'bun install failed' }
}

$web = $null; $srv = $null; $dev = $null
try {
    $web = Start-Process bun -ArgumentList 'run', 'dev' -WorkingDirectory (Join-Path $root 'web') -NoNewWindow -PassThru
    $stamp = SourceStamp
    while ($true) {
        $srv = Start-Process $server -NoNewWindow -PassThru
        if (-not $NoSim) {
            $simArgs = @('-name', $SimName)
            foreach ($kv in $SimSet) { $simArgs += '-set', $kv }
            $dev = Start-Process $sim -ArgumentList $simArgs -NoNewWindow -PassThru
        }
        Say "running: http://localhost:3000/  (server pid $($srv.Id); Ctrl+C stops)"
        # Wait for a source change, then rebuild and restart the Go side.
        while ($true) {
            Start-Sleep -Milliseconds 800
            $now = SourceStamp
            if ($now -gt $stamp) { break }
            if ($srv.HasExited) { Say "server exited ($($srv.ExitCode)); waiting for a change"; $srv = $null; while ((SourceStamp) -le $stamp) { Start-Sleep -Milliseconds 800 }; break }
        }
        Start-Sleep -Milliseconds 300 # let the editor finish writing
        $stamp = SourceStamp
        Say 'change detected: rebuilding'
        Stop-Tree $dev; Stop-Tree $srv
        while (-not (Build)) {
            Say 'build failed; fix it and save again'
            while ((SourceStamp) -le $stamp) { Start-Sleep -Milliseconds 800 }
            $stamp = SourceStamp
        }
    }
} finally {
    Say 'stopping'
    Stop-Tree $dev; Stop-Tree $srv; Stop-Tree $web
}
