# AI Contribution Guidelines for RGCS

This document gives AI assistants (Claude, Codex, Copilot, or any LLM-based tool)
the rules for working on RGCS. It supplements [CONTRIBUTING.md](CONTRIBUTING.md),
[CLAUDE.md](CLAUDE.md) (working rules agreed with the user) and
[docs/handoff/README.md](docs/handoff/README.md) (status, setup, open items) —
all of which apply in full. Where this file and CONTRIBUTING.md overlap,
CONTRIBUTING.md is the public-facing source of truth.

RGCS is a ground control station: it can send commands, write parameters and
upload missions to real vehicles. Every change must be correct, tested, and
reviewable by a human.

---

## Table of Contents

- [1. Code of Conduct & Ethics](#1-code-of-conduct--ethics)
- [2. Repository Structure](#2-repository-structure)
- [3. Coding Style](#3-coding-style)
- [4. Build System](#4-build-system)
- [5. Testing](#5-testing)
- [6. Versioning & Releases](#6-versioning--releases)
- [7. Commit Messages](#7-commit-messages)
- [8. Pull Requests](#8-pull-requests)
- [9. Project-Specific Rules](#9-project-specific-rules)
- [10. What AI Should NOT Do](#10-what-ai-should-not-do)

---

## 1. Code of Conduct & Ethics

- **Never** fabricate test results, logs, or claim testing that was not actually performed.
- **Always** disclose that a contribution was AI-assisted. The human submitting
  bears full responsibility; "the AI wrote it" is not an acceptable answer in review.
- Report security problems only through [SECURITY.md](SECURITY.md) (GitHub private
  vulnerability reporting) — never in a public issue.
- Talk to the user in Japanese. Code, comments and commit messages are in English.

---

## 2. Repository Structure

```text
apps/rgcs-server/    # The server (axum). Binary crate, package name rgcs-server.
  src/               # API, auth, config (config.rs), hubs, per-feature *_api.rs
  ui/                # Web UI: React + TypeScript + MapLibre (Vite)
crates/
  rgcs-core/         # Shared domain types; TypeScript bindings via ts-rs
  rgcs-mavlink/      # MAVLink link, routing, commands, parameter/mission/log protocols
  rgcs-mission/      # Mission model, .waypoints reading/writing
  rgcs-store/        # SQLite storage (sqlx) and migrations
  rgcs-camera/       # Camera/gimbal drivers (incl. MT11), MAVLink camera
  rgcs-video/        # Video relay (WebRTC/WHEP via MediaMTX)
  rgcs-input/        # Gamepad input
  rgcs-ai/           # AI chat providers (proposals only; the operator executes)
  rgcs-guard/        # AI guard (experimental emergency intervention)
  rgcs-env/          # External data sources (weather etc.)
deploy/              # Pi install script, systemd unit, config.toml.example, MediaMTX config
  docker/            # build.Dockerfile (arm64 build), pi.Dockerfile (Pi stand-in),
                     # video.Dockerfile, preview.Dockerfile (x86_64 dev preview), compose.yaml
scripts/             # dev.sh (dev stack), sitl-docker.sh, e2e.sh, build-pi.sh, pi-sim.sh
docs/
  spec/              # Specifications 00–80 (80-network.md holds the product decisions)
  plan/              # implementation-plan.md
  superpowers/       # Feature designs (specs/) and plans (plans/)
  handoff/           # Status, setup and open items for whoever picks the work up
tests/               # fixtures/, pi/, sitl/ (Python SITL harnesses)
examples/plugins/    # Example plugins (plugins do not need the CLA)
dev-env/             # Development environment spec (Dockerfile) and the Muse
                     # sandbox (crun) restore procedure — see dev-env/README.md
```

Key facts:

- This repository (`r2s-gcs`) is the development master. The open-source
  repository is a separate tree (`rgcs-public`, published as `rtos-org/rgcs`);
  changes reach it through the user's publication flow, not by pushing here.
- `docs/spec/80-network.md` §1 records the 2026-11-05 product decisions:
  Pi standalone bundle first (rgcs-node + rgcs-server on one Pi), Hub optional,
  OSS scope = everything except CloudHub.
- CloudHub is a separate, closed product. It is not in this repository and must
  never be added to it.

---

## 3. Coding Style

### Rust

- Format with `rustfmt` (`rustfmt.toml`: edition 2021, `max_width = 110`).
  CI runs `cargo fmt --all --check`.
- Clippy is a hard gate: `cargo clippy --workspace --all-targets -- -D warnings`.
- Toolchain is pinned by `rust-toolchain.toml`: stable + clippy/rustfmt +
  `aarch64-unknown-linux-gnu`. Workspace requires rust ≥ 1.85 (root `Cargo.toml`).
- Prefer files under 400 lines (800 max) and functions under 50 lines; keep state
  immutable (CONTRIBUTING.md / CLAUDE.md).
- Native build dependency: sqlx links the **system** SQLite through
  `libsqlite3-sys`, so a native build needs `pkg-config` and `libsqlite3-dev`
  (present by default on macOS and on the usual Linux dev machines; the Docker
  images install them explicitly).

### UI (TypeScript / React)

- Lint with oxlint: `npm run lint`. Tests with Vitest: `npm test -- --run`.
  Type-check: `npx tsc --noEmit -p tsconfig.app.json`.
- **Never run prettier** — the code is hand-formatted.
- Icons come from Lucide only, never text glyphs (checked by
  `src/test/no-glyph-icons.test.ts`).
- Ask for confirmation inside the app, never with `window.confirm`.
- UI text goes through the dictionaries in `ui/src/shared/i18n`, in all four
  languages; a test fails if a language misses a key.
- `ui/src/styles/prototype.css` is generated by `scripts/sync-css.py` — never
  hand-edit it.
- TypeScript bindings in `ui/src/shared/api/generated` are generated by ts-rs
  during `cargo test -p rgcs-core` (see `.cargo/config.toml`). If you change Rust
  types shared with the UI, run that test and commit the regenerated files; CI
  fails on a stale diff.

### Python

- Standard library only. Run scripts with `python3 -I`.

---

## 4. Build System

```sh
# Server (native)
cargo build -p rgcs-server

# UI
cd apps/rgcs-server/ui && npm ci && npm run build     # Node.js 22, npm only (no pnpm)

# Dev stack: ArduPilot SITL (Docker) + server + UI with hot reload on :5173
scripts/sitl-docker.sh build                          # once, from an ArduPilot checkout
scripts/dev.sh --docker --sitl 1                      # variants: --quadplane --plane --rover
scripts/dev.sh --built --no-sitl                      # server serves ui/dist itself on :8000

# Preview container (x86_64, built UI, no vehicle): http://127.0.0.1:8000
docker compose -f deploy/docker/compose.yaml up --build preview

# Raspberry Pi bundle (Pi 4B / 5 are the first-class node targets)
scripts/build-pi.sh                                   # arm64 build via deploy/docker/build.Dockerfile
scripts/pi-sim.sh                                     # Pi stand-in (pi.Dockerfile) for deploy testing
```

- Runtime state of the dev stack lives in `.dev/` (git-ignored).
- The server is configured by a TOML file (`RGCS_CONFIG` env var, default
  `/etc/rgcs/config.toml`); see `apps/rgcs-server/src/config.rs` for defaults
  (listen `0.0.0.0:8000`, MAVLink input `udpin:127.0.0.1:15555` by default) and
  `deploy/config.toml.example`.
- In the Muse sandbox, Docker cannot start containers; the same environment
  runs under crun via `~/opt/bin/devrun-rgcs` — see `dev-env/README.md`.

---

## 5. Testing

Write the test first (TDD) and watch it fail before implementing. Tests make no
network calls and no real AI/LLM calls: use fixtures and local fakes.

```sh
cargo test --workspace                                   # Rust unit + integration
cd apps/rgcs-server/ui && npm test -- --run              # Vitest (add --testTimeout=30000 under load)
scripts/e2e.sh                                           # Playwright, own server on :8010
tests/sitl/                                              # Python SITL harnesses (scratch instances 6/7)
```

Known pre-existing failure on main (documented in docs/handoff/README.md):
`rgcs-camera mavlink_cam::driver::tests::link_loss_disconnects_and_rebinds`.
Do not "fix" a red run by hiding or weakening it, and do not attribute it to
your change without evidence.

### What CI checks

This repository's `.github/workflows/ci.yml` runs on pushes to main and on PRs:

- **rust**: `cargo fmt --all --check`, clippy with `-D warnings`,
  `cargo test --workspace`, and a check that the generated TypeScript bindings
  are up to date.
- **cross-aarch64**: `cross build --release --target aarch64-unknown-linux-gnu -p rgcs-server`.
- **ui** (Node 22): `npm ci`, lint, unit tests, `npm run build`.
- **e2e**: Playwright (Chromium) against `scripts/e2e.sh`.

For the public repository, a security workflow (cargo audit + gitleaks, on push /
PR / weekly) and Dependabot (cargo + github-actions, weekly) were prepared on
the `chore/security-automation` branch (PR #1 in `rtos-org/rgcs`, pending merge
as of 2026-11-09). They are not part of this repository's `.github/` yet.

---

## 6. Versioning & Releases

- **Semantic Versioning 2.0.0.** The source of truth is the workspace version in
  the root `Cargo.toml` (`[workspace.package] version`, currently `0.1.0`).
- Releases are tagged `v<version>` with a GitHub Release taken from the
  changelog; the changelog follows *Keep a Changelog*. The release paperwork
  (CHANGELOG.md) is maintained on the public repository side — see
  `rgcs-public`'s CONTRIBUTING.md.
- 1.0.0 is reserved for the first field-recommended version.

---

## 7. Commit Messages

- **Conventional Commits**, in English: `feat(ui): …`, `fix(server): …`,
  `docs: …`, `test: …` (see `git log` for the scopes in use).
- One logical change per commit; keep changes small and focused.
- **The user pushes.** Do not push any branch, and do not open pull requests,
  unless the user explicitly asks in this session.
- Never commit `.claude/`, `auto.crt` or `auto.key`.

---

## 8. Pull Requests

- Public repository (`rtos-org/rgcs`): the ruleset rejects direct pushes to
  `main` — every change goes through a pull request.
- Contributors must agree to the CLA (the CLA bot comments on the first PR;
  see [CLA.md](CLA.md)). Plugins are exempt.
- Licence is **MPL-2.0** (root `Cargo.toml` and LICENSE).
- A change that can send commands to a vehicle, write parameters or missions,
  or change the confirmation rules needs tests for the refusal paths too, and a
  clear note in the PR (CONTRIBUTING.md, "Safety first").
- State explicitly that the work was AI-assisted and how it was tested.

---

## 9. Project-Specific Rules

- **Development management**: Muse acts as PM (security checks, issue triage,
  fixes, test upkeep, GitHub Actions) under the user's direction; the user
  reviews and gives requirements. Claude Code / Codex may be used as
  implementers.
- **Node targets**: Raspberry Pi 4B and 5 come first. The Pi runs the standalone
  bundle (rgcs-node + rgcs-server); a Hub is not required for a single vehicle.
- **Do not touch the dev stack's ports**: 5760–5793, 8000, 5173, 14550, 14551,
  37260. Scratch SITLs use instances 6 / 7.
- **Stop processes by PID.** No `pkill` or pattern kills.
- Unless asked, do not send commands to a vehicle or write parameters; a mission
  upload is a write — leave it to the user.
- SITL homes: Kamikochi (36.2509, 137.6385, 1505), +100 m north per vehicle;
  the QuadPlane uses its own home (see `scripts/dev.sh`, `QUADPLANE_HOME`).
- API calls with curl need the header `-H 'X-Requested-With: rgcs'` and a login
  cookie. The development login is documented in the README (development only —
  it exists so the dev stack works out of the box; deployments must change it).
- Never log, print or commit API keys. AI providers read keys from environment
  variables named in the config, never from the config file.

---

## 10. What AI Should NOT Do

- **Do not push** to `r2s-gcs` or `rgcs-public`, and do not create PRs, unless
  the user explicitly asks. (The public `main` is PR-only by ruleset anyway.)
- **Do not fabricate**: never invent APIs, parameters, MAVLink messages, or
  behaviour that does not exist in the codebase. Verify against the source.
- **Do not weaken safety**: do not bypass the command-confirmation rules, the AI
  guard's consent flow, or refusal paths; do not remove or weaken tests to make
  a run green.
- **Do not add CloudHub** or any closed-product code to this repository or to
  the public one.
- **Do not hand-edit generated files**: `ui/src/styles/prototype.css` and
  `ui/src/shared/api/generated/` are regenerated by their tools.
- **Do not commit secrets or machine-local files**: `.claude/`, `auto.crt`,
  `auto.key`, `.dev/` contents, real site coordinates in sample configs.
- **Do not run prettier**, and do not reformat code you did not change.
- **Do not make speculative large refactors.** Prefer the smallest change that
  solves the problem, with tests.
