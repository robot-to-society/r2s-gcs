# Development preview image (x86_64): rgcs-server serving the built UI on :8000,
# for checking the app in a browser without a Pi or a vehicle. NOT a deployment
# image — the Pi flow is pi.Dockerfile / scripts/build-pi.sh.
#
# The compose `preview` service (deploy/docker/compose.yaml) sets the build
# context to the repository root. A plain docker build needs the same:
#   docker build -f deploy/docker/preview.Dockerfile -t rgcs-preview .
# No SITL is started: the server keeps its default MAVLink input
# (udpin:127.0.0.1:15555) and simply waits, so the UI loads in its no-link state.

FROM node:22-bookworm-slim AS ui
WORKDIR /src/apps/rgcs-server/ui
COPY apps/rgcs-server/ui/package.json apps/rgcs-server/ui/package-lock.json ./
RUN npm ci
COPY apps/rgcs-server/ui/ ./
RUN npm run build

FROM rust:1-bookworm AS server
# libsqlite3-sys (via sqlx) links the system SQLite: it probes with pkg-config.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libsqlite3-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cargo build --release -p rgcs-server \
 && cp target/release/rgcs-server /rgcs-server

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl libsqlite3-0 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=server /rgcs-server /usr/local/bin/rgcs-server
COPY --from=ui /src/apps/rgcs-server/ui/dist /opt/rgcs/ui
COPY deploy/docker/preview.toml /etc/rgcs/config.toml
ENV RGCS_CONFIG=/etc/rgcs/config.toml
EXPOSE 8000
# Dev-preview only: runs as root so the named data volume needs no chown step.
CMD ["/usr/local/bin/rgcs-server"]
