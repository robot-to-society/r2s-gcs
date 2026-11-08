#!/usr/bin/env bash
# RGCS 開発環境の復旧スクリプト（Muse サンドボックス用）
#
# このサンドボックスの制約（ESC の dev-env で実証済みの方式を踏襲）:
# - 通常の Docker はコンテナ起動ができない（pull/export のみ）。代わりに crun を
#   直接使う devrun 方式でコンテナを実行する（使い捨てコンテナ＋名前空間は
#   mount/ipc/uts/pid のみ、ネットワークはホスト共有、cgroup 無効）。
# - システム領域と /tmp は VM 入れ替えで消えるが、ホームは残る。資産はすべて
#   ホーム配下に置く: ~/opt/dev-rootfs（ESC と共有のルートFS）、~/opt/dev-bundle-rgcs
#   （RGCS 用のバンドル設定）、~/opt/bin/devrun-rgcs（実行ラッパー）、
#   ~/.cargo / ~/.rustup（ホストの Rust ツールチェーン）、~/opt/node-v22（Node 22）。
# - ルートFS内への chown ができないため、tar/dpkg の展開は所有者を保持しない。
#
# このスクリプトの仕事:
# 1. ~/opt/dev-bundle-rgcs（/work にこのリポジトリ、/root/.cargo・/root/.rustup・
#    /opt/node をバインドする設定）と ~/opt/bin/devrun-rgcs を再作成する
# 2. Node 22 が無ければ ~/opt に導入する
# 3. ルートFSに pkg-config / libsqlite3-dev が無ければ deb から展開する
#    （sqlx の libsqlite3-sys がシステム SQLite にリンクするため必須）
# 4. スモークテスト（cargo / node のバージョンと対象ターゲット）
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VER="v22.23.4"

echo "== 1. devrun-rgcs のバンドルとラッパー =="
if [ ! -d "$HOME/opt/dev-bundle-rgcs" ]; then
  cp -r "$HOME/opt/dev-bundle-template" "$HOME/opt/dev-bundle-rgcs"
  python3 - "$HOME/opt/dev-bundle-rgcs/config.json" "$REPO" "$HOME" "node-$NODE_VER" <<'PY'
import json, sys
p, repo, home, node_dir = sys.argv[1:5]
c = json.load(open(p))
for m in c["mounts"]:
    if m["destination"] == "/work":
        m["source"] = repo
c["mounts"] += [
    {"destination": "/root/.cargo", "type": "bind", "source": f"{home}/.cargo", "options": ["bind", "rw"]},
    {"destination": "/root/.rustup", "type": "bind", "source": f"{home}/.rustup", "options": ["bind", "rw"]},
    {"destination": "/opt/node", "type": "bind", "source": f"{home}/opt/{node_dir}", "options": ["bind", "ro"]},
]
json.dump(c, open(p, "w"), indent=1)
PY
fi
if [ ! -x "$HOME/opt/bin/devrun-rgcs" ]; then
  sed 's#dev-bundle-template#dev-bundle-rgcs#' "$HOME/opt/bin/devrun" > "$HOME/opt/bin/devrun-rgcs"
  chmod +x "$HOME/opt/bin/devrun-rgcs"
fi

echo "== 2. Node 22 =="
if [ ! -x "$HOME/opt/node-$NODE_VER/bin/node" ]; then
  ( cd "$HOME/opt" \
    && curl -fsSL -o node.tar.xz "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz" \
    && tar --no-same-owner -xf node.tar.xz \
    && mv "node-$NODE_VER-linux-x64" "node-$NODE_VER" \
    && rm node.tar.xz )
fi
ln -sfn "node-$NODE_VER" "$HOME/opt/node-v22"

echo "== 3. ルートFSのネイティブ依存（pkg-config / libsqlite3-dev） =="
if ! "$HOME/opt/bin/devrun-rgcs" bash -c 'command -v pkg-config >/dev/null && pkg-config --exists sqlite3'; then
  TMPD="$(mktemp -d)"
  ( cd "$TMPD" \
    && apt-get download pkg-config pkgconf pkgconf-bin libpkgconf3 libsqlite3-dev \
    && for d in ./*.deb; do dpkg-deb -x "$d" "$HOME/opt/dev-rootfs"; done )
  rm -rf "$TMPD"
fi

echo "== 4. スモークテスト =="
"$HOME/opt/bin/devrun-rgcs" bash -c \
  'export PATH=/root/.cargo/bin:/opt/node/bin:$PATH; cargo --version; node --version; rustup target list --installed; pkg-config --modversion sqlite3'
echo "復旧完了"
