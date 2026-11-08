# RGCS 開発環境（Muse サンドボックス）

## 全体像

- 開発マスターはこのリポジトリ。Muse 環境では `~/workspace/r2s-gcs` に置く
  （2026-11-09 に Mac mini の `/Users/rtos/github/r2s-gcs` から複写。push は川村の
  合図があるまで禁止 — AGENTS.md 参照）。
- 環境の正本は `dev-env/Dockerfile`（Rust stable + Node 22 + ネイティブ依存）。
  Docker が使える機械ではそれを使う。
- このサンドボックスでは通常の Docker でコンテナを起動できないため、ESC で
  実証済みの crun 方式で同じ環境を実行する。crun はあくまでこの環境での
  実行手段で、仕様は Dockerfile が正本。

## crun 方式の構成（`devrun-rgcs`）

- 実行: `~/opt/bin/devrun-rgcs bash -c '<command>'`（使い捨てコンテナで1コマンド実行。
  状態はルートFSとバインドマウント側に残る）
- バンドル設定: `~/opt/dev-bundle-rgcs/config.json`（ESC の dev-bundle-template 派生）
  - ルートFS: `~/opt/dev-rootfs`（ESC と共有の Ubuntu 24.04）
  - `/work` ← このリポジトリ
  - `/root/.cargo`・`/root/.rustup` ← ホストの Rust ツールチェーン
    （cargo 1.99.1 stable、clippy / rustfmt、aarch64 + x86_64 ターゲット、cargo-audit）
  - `/opt/node` ← `~/opt/node-v22`（Node.js 22.23.4）
- ルートFS側の追加: pkg-config + libsqlite3-dev（sqlx の libsqlite3-sys が
  システム SQLite にリンクするため必須。deb を展開して入れてある）
- コマンド内では PATH を通す: `export PATH=/root/.cargo/bin:/opt/node/bin:$PATH`
- VM 入れ替え後の復旧は `dev-env/restore.sh`（バンドル・ラッパー・Node・deb を再作成）。

## よく使うコマンド（コンテナ内、/work で）

```sh
# Rust
cargo build -p rgcs-server
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check

# UI
cd apps/rgcs-server/ui && npm ci && npm run build   # ついでに npm run lint / npm test -- --run

# プレビュー（ビルド済み UI を server が :8000 で配信。SITL なし）
# .dev/preview.toml を作って RGCS_CONFIG に渡す（dev.sh --built --no-sitl 相当。
# dev.sh 自体は SITL バイナリを探すので、この環境では直接起動する）
mkdir -p .dev/data
cat > .dev/preview.toml <<'TOML'
listen = "127.0.0.1:8000"
data_dir = "/work/.dev/data"
role = "standalone"
ui_dir = "/work/apps/rgcs-server/ui/dist"
telemetry_interval_ms = 100

[ai]
provider = "none"
TOML
RGCS_CONFIG=/work/.dev/preview.toml cargo run -q -p rgcs-server &
curl http://127.0.0.1:8000/api/health
```

Docker が使える機械では compose の preview サービスが同じことをする:
`docker compose -f deploy/docker/compose.yaml up --build preview`
→ http://127.0.0.1:8000（ループバックのみ公開）。

## 既知の制約

- コンテナのネットワークはホスト共有。ポート 8000 はホストの 127.0.0.1 にそのまま出る。
- SITL はこの環境では動かさない（ArduPilot SITL バイナリ／Docker SITL の成果物が
  手元に無いため）。dev スタック（scripts/dev.sh）の SITL 連携は Mac 等の
  Docker が使える機械で行う。sitl-docker.sh の成果物は `.dev/sitl-docker/` に
  置かれるので、持ち込めば `--docker` 経路は使える見込み（未検証）。
- コンテナ内で apt を使うときは `-o APT::Sandbox::User=root` が必要（ESC の知見）。
  追加パッケージは原則 deb 展開でルートFSに入れ、restore.sh に反映する。
- ルートFS内のファイル所有者は実質すべて root（展開時の制約）。
