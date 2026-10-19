#!/usr/bin/env bash
# One-shot local dev stack: ArduCopter SITL + rgcs-server + UI.
#
#   scripts/dev.sh            # Vite dev server with HMR on :5173 (proxies /api and /ws to :8000)
#   scripts/dev.sh --built    # serve apps/rgcs-server/ui/dist from rgcs-server on :8000 (builds if missing)
#   scripts/dev.sh --no-sitl  # reuse a SITL you already started on tcp:5760
#   scripts/dev.sh --siyi-sim # also run the MT11 simulator on 37260 and point UAV-01's camera at it
#   scripts/dev.sh --video    # also run MediaMTX + ffmpeg test pattern (scripts/dev-video.sh)
#   scripts/dev.sh --sitl 3   # three SITL vehicles (SYSID 1..3, homes ~100 m apart) through
#                             # scripts/mav-relay.py on udp:14550 -> rgcs-server udpin:14551
#
# Env overrides: ARDUPILOT_DIR, SITL_HOME (lat,lon,alt,yaw), SITL_SPEEDUP, SITL_COUNT, RGCS_PORT, UI_PORT.
# Everything runtime-related lives in .dev/ (git-ignored). Ctrl-C stops all three processes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="$ROOT/.dev"
UI_DIR="$ROOT/apps/rgcs-server/ui"
ARDUPILOT_DIR="${ARDUPILOT_DIR:-$HOME/github/rtos/ardupilot}"
SITL_BIN="$ARDUPILOT_DIR/build/sitl/bin/arducopter"
SITL_PARAMS="$ARDUPILOT_DIR/Tools/autotest/default_params/copter.parm"
SITL_HOME="${SITL_HOME:-36.2509,137.6385,1505,0}"  # 上高地 (河童橋付近): 3D 地図の確認用
SITL_SPEEDUP="${SITL_SPEEDUP:-1}"
SITL_PORT=5760
SITL_COUNT="${SITL_COUNT:-1}"
RELAY_VEHICLE_PORT=14550
RELAY_SERVER_PORT=14551
RGCS_PORT="${RGCS_PORT:-8000}"
UI_PORT="${UI_PORT:-5173}"

MODE="vite"
START_SITL=1
SIYI_SIM=0
VIDEO=0
ARGS=("$@")
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  case "$arg" in
    --sitl) i=$((i + 1)); SITL_COUNT="${ARGS[$i]:-}" ;;
    --built) MODE="built" ;;
    --no-sitl) START_SITL=0 ;;
    --siyi-sim) SIYI_SIM=1 ;;
    --video) VIDEO=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p "$DEV_DIR/sitl" "$DEV_DIR/data"

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  echo
  echo "[dev] stopping..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if ! [[ "$SITL_COUNT" =~ ^[1-9]$ ]]; then
  echo "[dev] --sitl / SITL_COUNT must be 1..9 (got '$SITL_COUNT')" >&2
  exit 2
fi

# The i-th vehicle's home: SITL_HOME moved ~100 m north per vehicle.
home_of() {
  awk -v h="$SITL_HOME" -v i="$1" 'BEGIN { split(h, p, ","); printf "%.6f,%s,%s,%s", p[1] + i * 0.0009, p[2], p[3], p[4] }'
}

# --- 1. SITL -----------------------------------------------------------------
if [ "$START_SITL" = 1 ] && [ "$SITL_COUNT" -gt 1 ]; then
  if [ ! -x "$SITL_BIN" ]; then
    echo "[dev] SITL binary not found: $SITL_BIN (build ArduPilot sitl or set ARDUPILOT_DIR)" >&2
    exit 1
  fi
  echo "[dev] starting the MAVLink relay (vehicles udp:$RELAY_VEHICLE_PORT -> server udp:$RELAY_SERVER_PORT) -> $DEV_DIR/relay.log"
  python3 -I "$ROOT/scripts/mav-relay.py" "$RELAY_VEHICLE_PORT" "$RELAY_SERVER_PORT" >"$DEV_DIR/relay.log" 2>&1 &
  PIDS+=($!)
  for ((i = 0; i < SITL_COUNT; i++)); do
    dir="$DEV_DIR/sitl/$((i + 1))"
    mkdir -p "$dir"
    echo "[dev] starting SITL #$((i + 1)) (SYSID $((i + 1)), home $(home_of "$i")) -> $DEV_DIR/sitl-$((i + 1)).log"
    (cd "$dir" && exec "$SITL_BIN" --model + --speedup "$SITL_SPEEDUP" --defaults "$SITL_PARAMS" \
        --home "$(home_of "$i")" -I"$i" --sysid "$((i + 1))" --serial0 "udpclient:127.0.0.1:$RELAY_VEHICLE_PORT" -w) \
        >"$DEV_DIR/sitl-$((i + 1)).log" 2>&1 &
    PIDS+=($!)
  done
elif [ "$START_SITL" = 1 ]; then
  if port_in_use "$SITL_PORT"; then
    echo "[dev] SITL already listening on tcp:$SITL_PORT, reusing it"
  else
    if [ ! -x "$SITL_BIN" ]; then
      echo "[dev] SITL binary not found: $SITL_BIN (build ArduPilot sitl or set ARDUPILOT_DIR)" >&2
      exit 1
    fi
    echo "[dev] starting ArduCopter SITL (home $SITL_HOME, speedup $SITL_SPEEDUP) -> $DEV_DIR/sitl.log"
    (cd "$DEV_DIR/sitl" && exec "$SITL_BIN" --model + --speedup "$SITL_SPEEDUP" \
        --defaults "$SITL_PARAMS" --home "$SITL_HOME" -I0 -w) >"$DEV_DIR/sitl.log" 2>&1 &
    PIDS+=($!)
  fi
fi

# --- 2. rgcs-server ----------------------------------------------------------
if port_in_use "$RGCS_PORT"; then
  echo "[dev] port $RGCS_PORT already in use; stop the other rgcs-server first" >&2
  exit 1
fi

CONFIG="$DEV_DIR/config.toml"
{
  echo "listen = \"127.0.0.1:$RGCS_PORT\""
  if [ "$SITL_COUNT" -gt 1 ]; then
    echo "mavlink_url = \"udpin:127.0.0.1:$RELAY_SERVER_PORT\""
  else
    echo "mavlink_url = \"tcp:127.0.0.1:$SITL_PORT\""
  fi
  echo "data_dir = \"$DEV_DIR/data\""
  echo "role = \"standalone\""
  echo "telemetry_interval_ms = 100"
  if [ "$VIDEO" = 1 ]; then echo "whep_upstream = \"http://127.0.0.1:8889/video1/whep\""; fi
  if [ "$MODE" = "built" ]; then echo "ui_dir = \"$UI_DIR/dist\""; fi
} >"$CONFIG"

if [ "$MODE" = "built" ] && [ ! -f "$UI_DIR/dist/index.html" ]; then
  echo "[dev] ui/dist missing, building UI once..."
  (cd "$UI_DIR" && npm run build)
fi

if [ "$SIYI_SIM" = 1 ]; then
  echo "[dev] starting MT11 simulator on 37260 -> $DEV_DIR/siyi-sim.log"
  (cd "$ROOT" && exec cargo run -q -p rgcs-camera --features sim --example siyi_sim -- --port 37260) >"$DEV_DIR/siyi-sim.log" 2>&1 &
  PIDS+=($!)
fi
if [ "$VIDEO" = 1 ]; then
  "$ROOT/scripts/dev-video.sh" >"$DEV_DIR/video.log" 2>&1 &
  PIDS+=($!)
fi

echo "[dev] starting rgcs-server (config $CONFIG)"
(cd "$ROOT" && RGCS_CONFIG="$CONFIG" exec cargo run -q -p rgcs-server) &
PIDS+=($!)

if [ "$SIYI_SIM" = 1 ]; then
  # Point UAV-01's camera profile at the simulator once the API answers.
  (
    for _ in $(seq 1 120); do curl -sf --max-time 1 "http://127.0.0.1:$RGCS_PORT/api/health" >/dev/null && break; sleep 1; done
    J=$(mktemp)
    curl -s -c "$J" -H 'X-Requested-With: rgcs' -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}' "http://127.0.0.1:$RGCS_PORT/api/auth/login" >/dev/null
    curl -s -b "$J" -H 'X-Requested-With: rgcs' -H 'content-type: application/json' -X PUT \
      -d '{"kind":"siyi_mt11","host":"127.0.0.1","port":37260}' "http://127.0.0.1:$RGCS_PORT/api/vehicles/1/camera/profile" >/dev/null \
      && echo "[dev] UAV-01 camera profile -> MT11 simulator"
    rm -f "$J"
  ) &
fi

# --- 3. UI -------------------------------------------------------------------
if [ "$MODE" = "vite" ]; then
  echo "[dev] starting Vite dev server on :$UI_PORT"
  (cd "$UI_DIR" && RGCS_SERVER="http://127.0.0.1:$RGCS_PORT" exec npm run dev -- --host 127.0.0.1 --port "$UI_PORT" --strictPort) &
  PIDS+=($!)
  URL="http://127.0.0.1:$UI_PORT"
else
  URL="http://127.0.0.1:$RGCS_PORT"
fi

echo
echo "[dev] UI:      $URL"
echo "[dev] API:     http://127.0.0.1:$RGCS_PORT/api/health"
if [ "$SITL_COUNT" -gt 1 ]; then
  echo "[dev] SITL:    $SITL_COUNT vehicles via the relay (logs $DEV_DIR/sitl-N.log, $DEV_DIR/relay.log)"
else
  echo "[dev] SITL:    tcp:127.0.0.1:$SITL_PORT (telemetry streams start ~10-15 s after link-up)"
  echo "[dev] SITL log: $DEV_DIR/sitl.log"
fi
echo "[dev] Ctrl-C stops everything."
echo

wait
