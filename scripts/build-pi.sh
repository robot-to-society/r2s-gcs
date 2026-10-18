#!/usr/bin/env bash
# Builds the Raspberry Pi artifacts into dist/pi/:
#   rgcs-server  aarch64, release, UI embedded (feature embed-ui)
#   siyi_sim     aarch64 MT11 simulator (for the Docker Pi equivalent)
#   VERSION      <crate version>+<git sha>
# The UI is built on the host (platform independent); Rust builds natively in a
# linux/arm64 rust:bookworm container with cargo caches in named volumes, so the host
# target/ directory is not touched.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist/pi"
IMAGE=rgcs-build-arm64

echo "[build-pi] UI"
(cd "$ROOT/apps/rgcs-server/ui" && npm run build >/dev/null)

echo "[build-pi] build image"
docker build -q --platform linux/arm64 -t "$IMAGE" -f "$ROOT/deploy/docker/build.Dockerfile" "$ROOT/deploy/docker" >/dev/null

echo "[build-pi] cargo build --release (aarch64)"
docker run --rm --platform linux/arm64 \
  -v "$ROOT:/src" \
  -v rgcs-cargo-registry:/usr/local/cargo/registry \
  -v rgcs-target-arm64:/target \
  -e CARGO_TARGET_DIR=/target \
  -e CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=gcc \
  "$IMAGE" sh -c '
    export RUSTUP_TOOLCHAIN="$(rustup default | cut -d" " -f1)" &&
    cargo build --release --locked -p rgcs-server --features embed-ui &&
    cargo build --release --locked -p rgcs-camera --features sim --example siyi_sim &&
    mkdir -p /src/dist/pi &&
    cp /target/release/rgcs-server /src/dist/pi/rgcs-server &&
    cp /target/release/examples/siyi_sim /src/dist/pi/siyi_sim'

version=$(grep -m1 '^version' "$ROOT/Cargo.toml" | sed 's/.*"\(.*\)"/\1/')
echo "$version+$(git -C "$ROOT" rev-parse --short HEAD)" >"$OUT/VERSION"
echo "[build-pi] done: $(cat "$OUT/VERSION") -> $OUT"
