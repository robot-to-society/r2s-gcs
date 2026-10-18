# Deploying rgcs-server on the companion Pi

1. Build on the Mac: `scripts/build-pi.sh` → `dist/pi/rgcs-pi-<version>.tar.gz` (aarch64 binary with
   the UI embedded, `install.sh`, `rgcs-server.service`, `config.toml.example`). Copy it to the Pi and
   run `tar xzf rgcs-pi-<version>.tar.gz && cd rgcs-pi-<version> && sudo ./install.sh`. The same
   command upgrades; `sudo ./install.sh --rollback` restores the previous release. Details, file
   locations and what the installer does: `docs/spec/30-architecture.md` §8.
   First install only: edit `/etc/rgcs/config.toml` (`mavlink_url`, `whep_upstream`) and
   `sudo systemctl restart rgcs-server`. `data_dir` (`/var/lib/rgcs`) holds the SQLite database, the
   audience logo and the fetched logs. The development login admin/admin is active until accounts
   arrive (M5): reach port 8000 only over the vehicle LAN / VPN.
   Try the whole deployment first on the Docker Pi equivalent: `scripts/pi-sim.sh up` then
   `tests/pi/accept-deploy.sh` (§8.1).
2. MediaMTX: copy `mediamtx.yml` to `/usr/local/etc/mediamtx.yml` and enable `mediamtx.service`.
   It relays the MT11 RTSP stream (`rtsp://192.168.144.25:8554/video1`) as WebRTC; signalling
   stays on `127.0.0.1:8889` because `rgcs-server` relays WHEP offers (`whep_upstream`), media goes
   out on UDP/TCP 8189 — allow that port from the operator's LAN / VPN only.
3. `rgcs-server.service` replaces the Python `mt11-camera-ui.service` (both open the MT11 TCP
   control port, which accepts a single client: never run them together).
4. Audience page: create a link in the UI (user menu → 観客用画面), open `/present?t=…` in a separate
   browser window on the second monitor and press F11. Revoke the link afterwards.

Day before the flight (addendum §4): plan the mission in RGCS (ミッション tab), 保存, then
`.waypoints 保存` and load the file in Mission Planner to simulate. If you edit it there, save it
from Mission Planner and load it back with ファイル読込 (the `.waypoints` round trip is exact).
On the day only RGCS talks to the vehicle (§9): 機体へ書込 verifies the read-back before you
ARM / AUTO from the operations panel.

Development on a Mac: `scripts/dev.sh --siyi-sim --video` runs SITL, the MT11 simulator, MediaMTX +
an ffmpeg test pattern and the UI; `scripts/e2e.sh --with-sitl --with-sim --with-video` runs every
Playwright journey (`brew install mediamtx ffmpeg` first).
