# Deploying rgcs-server on the companion Pi

1. `config.toml` → `/etc/rgcs/config.toml` (see `config.toml.example`). `data_dir` holds the SQLite
   database, the audience logo (`branding/`) and later the logs.
2. MediaMTX: copy `mediamtx.yml` to `/usr/local/etc/mediamtx.yml` and enable `mediamtx.service`.
   It relays the MT11 RTSP stream (`rtsp://192.168.144.25:8554/video1`) as WebRTC; signalling
   stays on `127.0.0.1:8889` because `rgcs-server` relays WHEP offers (`whep_upstream`), media goes
   out on UDP/TCP 8189 — allow that port from the operator's LAN / VPN only.
3. `rgcs-server.service` replaces the Python `mt11-camera-ui.service` (both open the MT11 TCP
   control port, which accepts a single client: never run them together).
4. Audience page: create a link in the UI (user menu → 観客用画面), open `/present?t=…` in a separate
   browser window on the second monitor and press F11. Revoke the link afterwards.

Development on a Mac: `scripts/dev.sh --siyi-sim --video` runs SITL, the MT11 simulator, MediaMTX +
an ffmpeg test pattern and the UI; `scripts/e2e.sh --with-sitl --with-sim --with-video` runs every
Playwright journey (`brew install mediamtx ffmpeg` first).
