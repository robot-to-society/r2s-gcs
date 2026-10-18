#!/usr/bin/env bash
# P6 deployment acceptance on the Docker Pi equivalent (scripts/pi-sim.sh up, fresh).
# Needs: dist/pi from scripts/build-pi.sh, the host SITL on tcp:5760 and NO other client on it
# (stop scripts/dev.sh). Prints "ACCEPT deploy: OK" or FAIL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="http://127.0.0.1:18000"
H='X-Requested-With: rgcs'
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
DC=(docker compose -f "$ROOT/deploy/docker/compose.yaml")
pi() { "${DC[@]}" exec -T pi "$@"; }
sim() { "$ROOT/scripts/pi-sim.sh" "$@"; }
fail() { echo "FAIL: $*"; exit 1; }
warn() { echo "    WARN: $*"; }
# eval runs only expressions written in this script (same helper as tests/sitl/*.sh).
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
api() { curl -s -b "$JAR" -c "$JAR" -H "$H" "$@"; }
japi() { api -H 'content-type: application/json' "$@"; }
healthy() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health")" = 200 ]; }
wait_healthy() { for _ in $(seq 1 "${1:-60}"); do healthy && return 0; sleep 1; done; return 1; }
login() { japi -d '{"username":"admin","password":"admin"}' "$URL/api/auth/login" | json 'd["data"]["username"]' | grep -q admin; }
link_ok() { api "$URL/api/vehicles/1" | json 'd.get("data") and d["data"]["link"]' 2>/dev/null | grep -qx ok; }
wait_link() { for _ in $(seq 1 "${1:-45}"); do link_ok && return 0; sleep 1; done; return 1; }
set_link_url() { pi sed -i "s|^mavlink_url = .*|mavlink_url = \"$1\"|" /etc/rgcs/config.toml; }
armed() { api "$URL/api/vehicles/1" | json 'd["data"]["armed"]'; }
wait_armed() { for _ in $(seq 1 40); do [ "$(armed)" = "$1" ] && return 0; sleep 0.25; done; return 1; }
send_confirmed() {
  local tok
  tok=$(japi -d "{\"cmd\":\"$1\"}" "$URL/api/vehicles/1/confirm" | json 'd["data"]["confirm_token"]')
  japi -d "{\"cmd\":\"$1\",\"confirm_token\":\"$tok\"}" "$URL/api/vehicles/1/command" >/dev/null
}

[ -x "$ROOT/dist/pi/rgcs-server" ] || fail "run scripts/build-pi.sh first"
good=$(pi /mnt/dist/rgcs-server --version)

echo "[1] fresh install takes over from the Python service"
[ "$(pi systemctl is-active mt11-camera-ui || true)" = active ] || fail "start from a fresh pi-sim (stand-in not active)"
sim install | tail -3
[ "$(pi systemctl is-active rgcs-server)" = active ] || fail "rgcs-server not active"
[ "$(pi systemctl is-enabled rgcs-server)" = enabled ] || fail "rgcs-server not enabled"
[ "$(pi systemctl is-active mt11-camera-ui || true)" = inactive ] || fail "Python stand-in still running"
[ "$(pi systemctl is-enabled mt11-camera-ui || true)" = disabled ] || fail "Python stand-in still enabled"
healthy || fail "/api/health"
curl -s "$URL/" | grep -q '<div id="root">' || fail "embedded UI not served"
pi test -f /etc/rgcs/config.toml || fail "config not created"
[ "$(pi stat -c %U /var/lib/rgcs)" = rgcs ] || fail "/var/lib/rgcs not owned by rgcs"
pi systemctl start mt11-camera-ui
sleep 1
[ "$(pi systemctl is-active rgcs-server || true)" != active ] || fail "Conflicts= did not stop rgcs-server"
pi systemctl stop mt11-camera-ui
pi systemctl start rgcs-server
wait_healthy || fail "rgcs-server did not come back"

echo "[2] vehicle over the Rpanion UDP link"
sim link udp >/dev/null
login || fail "login"
wait_link || fail "vehicle 1 not linked over udp:15555"
state=$(api "$URL/api/vehicles/1" | json '(d["data"]["armed"], d["data"]["mode"], round(d["data"]["alt_rel"], 1))')
case "$state" in
  "(False,"*) ;;
  *) fail "SITL is not on the ground and disarmed $state; restart SITL (-w) before this acceptance" ;;
esac

echo "[3] existing SITL acceptance against the Pi"
# Telemetry streams start after the 10 s request grace: wait for a 3D fix so the first ARM has a position.
for _ in $(seq 1 60); do
  [ "$(api "$URL/api/vehicles/1" | json 'd["data"]["gps"]["fix"] >= 3')" = True ] && break; sleep 1
done
for t in accept-m1 accept-params accept-logbook; do
  out=$(RGCS_URL="$URL" "$ROOT/tests/sitl/$t.sh" 2>&1) || { echo "$out" | tail -5; fail "$t"; }
  echo "    $(echo "$out" | tail -1)"
done

echo "[4] upgrade keeps config and data"
pi sh -c 'echo "# keep-me" >> /etc/rgcs/config.toml'
login
before=$(api "$URL/api/vehicles/1/flights" | json 'len(d["data"])')
sim install | tail -1
grep -q 'keep-me' <(pi cat /etc/rgcs/config.toml) || fail "config overwritten"
login
after=$(api "$URL/api/vehicles/1/flights" | json 'len(d["data"])')
[ "$before" = "$after" ] || fail "flights $before -> $after after upgrade"
pi test -x /opt/rgcs/bin/rgcs-server.prev || fail "no .prev kept"
echo "    flights kept: $after"

echo "[5] restart while armed"
wait_link || fail "no link before arming"
[ "$(armed)" = True ] && { send_confirmed disarm; wait_armed False; }
n0=$(api "$URL/api/vehicles/1/flights" | json 'len(d["data"])')
send_confirmed arm
if wait_armed True; then
  pi systemctl restart rgcs-server
  wait_healthy || fail "not healthy after restart"
  login; wait_link || fail "no link after restart"
  send_confirmed disarm
  wait_armed False || fail "could not disarm"
  sleep 3
  flights=$(api "$URL/api/vehicles/1/flights")
  n1=$(echo "$flights" | json 'len(d["data"])')
  last_landed=$(echo "$flights" | json 'd["data"][-1]["landed_at"] is not None')
  open=$(echo "$flights" | json 'sum(1 for f in d["data"] if f["landed_at"] is None)')
  [ "$open" = 0 ] || fail "$open flight(s) left open after the restart"
  [ "$last_landed" = True ] || fail "last flight not landed"
  [ $((n1 - n0)) -le 1 ] || fail "restart created a second flight ($n0 -> $n1)"
  echo "    flights $n0 -> $n1, none open"
else
  warn "SITL refused to arm (PreArm); restart-while-armed not exercised"
fi

echo "[6] serial link"
set_link_url "/dev/ttyFC,57600"; sim link serial >/dev/null; pi systemctl restart rgcs-server
wait_healthy || fail "not healthy on serial"
login; wait_link 60 || fail "no vehicle over /dev/ttyFC"
[ "$(api "$URL/api/vehicles/1/logs" | json 'd["data"]["fetch_enabled"]')" = False ] || fail "57600: log fetch should be off"
# A pty keeps TIOCEXCL while socat holds the master (a real UART is released on close): new pty.
set_link_url "/dev/ttyFC,921600"; sim link serial >/dev/null; pi systemctl restart rgcs-server
wait_healthy; login; wait_link 60 || fail "no vehicle at 921600"
[ "$(api "$URL/api/vehicles/1/logs" | json 'd["data"]["fetch_enabled"]')" = True ] || fail "921600: log fetch should be on"
set_link_url "udpin:127.0.0.1:15555"; sim link udp >/dev/null; pi systemctl restart rgcs-server
wait_healthy; login; wait_link || fail "no vehicle after returning to udp"

echo "[7] broken upgrade rolls back"
out=$("${DC[@]}" exec -T pi /mnt/deploy/deploy/install.sh --binary /mnt/deploy/tests/pi/fixtures/broken-server.sh --health-timeout 10 2>&1) && fail "installer accepted a broken release"
echo "$out" | grep -q 'ROLLED BACK' || { echo "$out" | tail -5; fail "no ROLLED BACK message"; }
wait_healthy || fail "not healthy after rollback"
[ "$(pi /opt/rgcs/bin/rgcs-server --version)" = "$good" ] || fail "wrong version after rollback"

echo "[8] reboot"
# mediamtx / video share the Pi's network namespace: restart the Pi first, then rejoin them.
"${DC[@]}" restart pi >/dev/null 2>&1
"${DC[@]}" restart mediamtx video >/dev/null 2>&1
for _ in $(seq 1 60); do [ "$(pi systemctl is-active rgcs-server 2>/dev/null || true)" = active ] && break; sleep 1; done
wait_healthy 60 || fail "rgcs-server not back after reboot"
[ "$(pi systemctl is-enabled mt11-camera-ui || true)" = disabled ] || fail "Python stand-in re-enabled"
echo "ACCEPT deploy: OK ($good)"
