# RGCS 開発環境（環境仕様書）
# 開発に必要なツールチェーン一式の「入れるもの」の仕様。Docker が使える機械では
# このイメージがそのまま開発コンテナになる。Muse サンドボックス内では通常の
# docker run が使えないため、同じ内容を crun で実行する（手順は restore.sh と
# dev-env/README.md。正本はこの Dockerfile、crun はこの環境での実行手段）。
FROM rust:1-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# ビルドに必要なネイティブ依存:
# - pkg-config + libsqlite3-dev: sqlx の libsqlite3-sys がシステム SQLite にリンクする
# - gcc-aarch64-linux-gnu: .cargo/config.toml が指定する aarch64 向けリンカ
# - python3: リポジトリのスクリプト用（標準ライブラリのみ、python3 -I で実行）
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config \
      libsqlite3-dev \
      gcc-aarch64-linux-gnu \
      git \
      curl \
      python3 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# rust-toolchain.toml の指定（stable + clippy / rustfmt + aarch64 ターゲット）
RUN rustup component add clippy rustfmt \
 && rustup target add aarch64-unknown-linux-gnu

# UI 用 Node.js 22（CONTRIBUTING / CI と同じメジャー）
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work
CMD ["/bin/bash"]
