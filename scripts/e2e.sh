#!/usr/bin/env bash
# Playwright E2E against a real rgcs-server serving the built UI.
#
#   scripts/e2e.sh               # no vehicle link needed (login / shell journeys)
#   scripts/e2e.sh --with-sitl   # also runs detail.spec.ts against SITL on tcp:5760
#
# Env: E2E_PORT (default 8010), RGCS_SERVER_BIN (default target/debug/rgcs-server, built if missing).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT/apps/rgcs-server/ui"
DEV_DIR="$ROOT/.dev"
PORT="${E2E_PORT:-8010}"
BIN="${RGCS_SERVER_BIN:-$ROOT/target/debug/rgcs-server}"
WITH_SITL=0
if [ "${1:-}" = "--with-sitl" ]; then
  WITH_SITL=1
  shift
fi

export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p "$DEV_DIR"
rm -rf "$DEV_DIR/e2e-data" && mkdir -p "$DEV_DIR/e2e-data"

if [ ! -x "$BIN" ]; then
  echo "[e2e] building rgcs-server"
  (cd "$ROOT" && cargo build -q -p rgcs-server)
fi
if [ ! -f "$UI_DIR/dist/index.html" ] || [ "${E2E_REBUILD_UI:-0}" = 1 ]; then
  echo "[e2e] building UI"
  (cd "$UI_DIR" && npm run build >/dev/null)
fi

CONFIG="$DEV_DIR/e2e-config.toml"
{
  echo "listen = \"127.0.0.1:$PORT\""
  echo "mavlink_url = \"tcp:127.0.0.1:5760\""
  echo "data_dir = \"$DEV_DIR/e2e-data\""
  echo "ui_dir = \"$UI_DIR/dist\""
} >"$CONFIG"

echo "[e2e] starting rgcs-server on :$PORT"
RGCS_CONFIG="$CONFIG" "$BIN" >"$DEV_DIR/e2e-server.log" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -sf --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 0.5
done
curl -sf --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "[e2e] server did not start"; cat "$DEV_DIR/e2e-server.log"; exit 1; }
[ "$WITH_SITL" = 1 ] && sleep 12   # streams start after the 10 s SET_MESSAGE_INTERVAL grace

cd "$UI_DIR"
if [ "$WITH_SITL" = 1 ]; then
  RGCS_E2E_SITL=1 E2E_BASE_URL="http://127.0.0.1:$PORT" npx playwright test "$@"
else
  E2E_BASE_URL="http://127.0.0.1:$PORT" npx playwright test "$@"
fi
