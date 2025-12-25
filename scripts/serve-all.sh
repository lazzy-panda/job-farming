#!/usr/bin/env bash
# Simple launcher for API + UI with auto-restart on exit (compatible with macOS bash 3.x)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NX_NATIVE_TUI=false
export NX_DAEMON=false
API_PORT="${API_PORT:-3000}"
UI_PORT=4216 # фиксированный порт для UI
OUTPUT_STYLE="${OUTPUT_STYLE:-stream}" # stream по умолчанию, без TUI

cd "$ROOT_DIR"

# Ensure correct Node version for better-sqlite3 (Prisma adapter).
# This script should be runnable even if nvm is not installed.
if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "${HOME}/.nvm/nvm.sh"
  nvm use 20 >/dev/null
fi

kill_port() {
  local port="$1"
  local label="$2"

  if ! command -v lsof >/dev/null 2>&1; then
    echo "WARN: lsof not found, cannot free port ${port} for ${label}"
    return 0
  fi

  local pids
  pids=$(lsof -ti tcp:"${port}" 2>/dev/null || true)
  if [ -z "${pids}" ]; then
    return 0
  fi

  echo "Killing processes on port ${port} (${label}): ${pids}"
  # First try graceful stop.
  kill -TERM ${pids} >/dev/null 2>&1 || true
  sleep 1

  # If still alive, force kill.
  local still
  still=$(lsof -ti tcp:"${port}" 2>/dev/null || true)
  if [ -n "${still}" ]; then
    echo "Force killing processes on port ${port} (${label}): ${still}"
    kill -KILL ${still} >/dev/null 2>&1 || true
  fi
}

cleanup() {
  echo "Stopping services..."
  pkill -f "nx serve api" || true
  pkill -f "nx serve ui" || true
  kill_port "${API_PORT}" "api"
  kill_port "${UI_PORT}" "ui"
}
trap cleanup EXIT INT TERM

RESTART="${RESTART:-false}" # set RESTART=true to enable auto-restart

run_once() {
  echo "Stopping existing nx serve processes..."
  pkill -f "nx serve api" || true
  pkill -f "nx serve ui" || true

  # free ports, even if API/UI were started outside nx (e.g. dist/apps/api/main.js)
  kill_port "${API_PORT}" "api"
  kill_port "${UI_PORT}" "ui"

  echo "Resetting Nx daemon/cache..."
  NX_DAEMON=false npx nx reset

  echo "Starting API on port ${API_PORT} and UI on port ${UI_PORT}..."

  (
    cd "$ROOT_DIR"
    # IMPORTANT: for @nx/js:node executor "--port" is the Node inspector port, not the HTTP port.
    # We pass the real HTTP port via env var PORT so Nest listens correctly.
    PORT="${API_PORT}" NX_DAEMON=false npx nx serve api --output-style="${OUTPUT_STYLE}"
  ) &
  API_PID=$!

  (
    cd "$ROOT_DIR"
    NX_DAEMON=false npx nx serve ui --host=127.0.0.1 --port="${UI_PORT}" --watch=false --output-style="${OUTPUT_STYLE}"
  ) &
  UI_PID=$!

  # Wait for any to exit (bash 3 doesn't support wait -n, so poll)
  while kill -0 "$API_PID" >/dev/null 2>&1 && kill -0 "$UI_PID" >/dev/null 2>&1; do
    sleep 2
  done

  echo "One of the services exited. Cleaning up..."
  kill "$API_PID" >/dev/null 2>&1 || true
  kill "$UI_PID" >/dev/null 2>&1 || true
  wait "$API_PID" 2>/dev/null || true
  wait "$UI_PID" 2>/dev/null || true
}

if [ "$RESTART" = "true" ]; then
  while true; do
    run_once
    echo "Restarting both services..."
  done
else
  run_once
  echo "Services stopped. Exiting without restart."
fi
