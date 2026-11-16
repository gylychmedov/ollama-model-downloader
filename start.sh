#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

info() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

wait_for() {
  local timeout=$1; shift
  local elapsed=0
  until "$@" >/dev/null 2>&1; do
    (( elapsed >= timeout )) && return 1
    sleep 2; elapsed=$((elapsed + 2))
  done
}

install_brew_package() {
  command -v brew >/dev/null || fail "$1 is missing and Homebrew is not installed. Install $1 manually."
  info "Installing $1 via Homebrew..."
  brew install "${@:2}"
}

# --- .env ---
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi
export OLLAMA_MODELS_DIR="${OLLAMA_MODELS_DIR:-$HOME/.ollama/models}"
export DOWNLOAD_CONNECTIONS="${DOWNLOAD_CONNECTIONS:-4}"
export WEB_PORT="${WEB_PORT:-3470}"
export API_PORT="${API_PORT:-8470}"
export DB_PORT="${DB_PORT:-5470}"
export REVEAL_PORT="${REVEAL_PORT:-8471}"

# --- Docker ---
command -v docker >/dev/null || install_brew_package docker --cask docker
if ! docker info >/dev/null 2>&1; then
  info "Starting Docker Desktop..."
  open -a Docker 2>/dev/null || fail "Could not start Docker. Start it manually and re-run."
  wait_for 120 docker info || fail "Docker did not start within 2 minutes."
fi
docker compose version >/dev/null 2>&1 || fail "'docker compose' plugin is not available."

# --- Ollama models dir ---
command -v ollama >/dev/null || warn "Ollama is not installed. Downloads work, but you need Ollama to run installed models (brew install ollama)."
mkdir -p "$OLLAMA_MODELS_DIR"
info "Ollama models dir: $OLLAMA_MODELS_DIR"

# --- Ports ---
OUR_PORTS="$(docker compose ps --format json 2>/dev/null | tr -d ' ' || true)"
for port in "$WEB_PORT" "$API_PORT" "$DB_PORT" "$REVEAL_PORT"; do
  [[ "$port" == "$REVEAL_PORT" && -f backend/bin/reveal-helper.pid ]] && continue
  if lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1 && [[ "$OUR_PORTS" != *"\"PublishedPort\":$port,"* ]]; then
    fail "Port $port is already in use by another process. Set a different one in .env (WEB_PORT / API_PORT / DB_PORT)."
  fi
done

# --- Restart stack ---
if [[ -n "$(docker compose ps -q 2>/dev/null)" ]]; then
  info "Stopping running containers (downloads resume automatically)..."
  docker compose down --remove-orphans
fi

# --- Reveal helper (host process so "Show in folder" can open Finder) ---
HELPER_BIN="$ROOT_DIR/backend/bin/reveal-helper"
HELPER_PID="$ROOT_DIR/backend/bin/reveal-helper.pid"
if [[ -f "$HELPER_PID" ]]; then
  kill "$(cat "$HELPER_PID")" 2>/dev/null || true
  rm -f "$HELPER_PID"
fi
info "Building reveal helper..."
mkdir -p "$ROOT_DIR/backend/bin"
case "$(uname -m)" in arm64|aarch64) GOARCH=arm64 ;; *) GOARCH=amd64 ;; esac
if docker run --rm -v "$ROOT_DIR/backend":/src -w /src \
    -e CGO_ENABLED=0 -e GOOS="$(uname -s | tr '[:upper:]' '[:lower:]')" -e GOARCH="$GOARCH" \
    golang:1.26-alpine go build -trimpath -o bin/reveal-helper ./cmd/reveal-helper; then
  nohup "$HELPER_BIN" >"$ROOT_DIR/backend/bin/reveal-helper.log" 2>&1 &
  echo $! >"$HELPER_PID"
else
  warn "Could not build the reveal helper. 'Show in folder' will not work."
fi

info "Building containers..."
docker compose build

info "Starting containers..."
docker compose up -d

info "Waiting for backend..."
backend_ready() {
  curl -sf http://localhost:$API_PORT/api/health >/dev/null && return 0
  [[ "$(docker compose ps -a --format '{{.State}}' backend)" == "running" ]] || return 2
  return 1
}

elapsed=0
until backend_ready; do
  status=$?
  if (( status == 2 )) || (( elapsed >= 120 )); then
    docker compose logs --tail 50 backend
    fail "Backend did not become healthy. Check: docker compose logs -f backend"
  fi
  sleep 2; elapsed=$((elapsed + 2))
done

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

info "Ready!"
echo
echo "   Frontend (this Mac):  http://localhost:$WEB_PORT"
echo "   Backend  (this Mac):  http://localhost:$API_PORT/api/health"
if [[ -n "$LAN_IP" ]]; then
  echo
  echo "   Frontend (network):   http://$LAN_IP:$WEB_PORT"
fi
echo
echo "   Logs:  docker compose logs -f"
echo "   Stop:  docker compose down && kill \$(cat backend/bin/reveal-helper.pid)"
