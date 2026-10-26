# PC 移行の引き継ぎ(2026-10-26)

旧 PC(Apple Silicon Mac)から新しい作業 PC へ移るための資料です。新しい PC では
**ArduPilot SITL を Docker で動かします**(ネイティブの ArduPilot ビルド環境は不要)。

- この README: 現状、新 PC のセットアップ、作業ルール、残課題
- `claude-memory/`: 旧 PC の Claude Code メモリの写し(復元方法は §4)
- `reviews/`: 各機能の最終レビューと UI/UX 監査の記録(残っている minor の一覧はここ)

## 1. 現状

- フェーズ 1 のロードマップ 1〜8 はすべて実装済みで main にマージ済みです。
  - 全機体映像、Copter 予測経路、点検・校正、詳細パネル、測量グリッド、カメラ(MT11 / MAVLink)、ネットワーク表示、POI
- その後に入った主なもの(すべて main):
  - AI チャット(提案のみ、実行はオペレータ)
  - AI 緊急介入(実験的機能。トイレットボウル検知 → ALT_HOLD / QHOVER を 1 回だけ)
  - Rover は TAKEOFF なしのミッションを書き込める(`Mission::validate_for(kind)`)
  - アプリ全体の UI/UX 見直し(監査 62 件中 59 件対応)
  - 3D 地図で機体が地形に埋まらない修正(Rover と未アームの機体は DEM の地面に置き、飛行中は地面より下に描かない)
- このリポジトリには **git リモートが設定されていません**。push の前に `git remote add origin <URL>` が必要です。
- ブランチは `main` だけ使えば足ります。`design-polish` は main にマージ済みで、そのワークツリー
  `../r2s-gcs-design` は移す必要がありません。
- 設計書: `docs/spec/`(00〜80)、`docs/plan/implementation-plan.md`、機能ごとの設計と計画は
  `docs/superpowers/specs/`、`docs/superpowers/plans/`。

## 2. 新しい PC のセットアップ

パスは旧 PC と同じ `~/github/rtos/` 配下を前提にしています(違う場所なら `ARDUPILOT_DIR` で指定)。

1. このリポジトリを `~/github/rtos/r2s-gcs` に clone します。
2. Rust: rustup を入れます。`rust-toolchain.toml` が stable + clippy / rustfmt + `aarch64-unknown-linux-gnu` を指定しています。
   旧 PC では rustup を PATH に入れていなかったので、毎回 `export PATH="$HOME/.cargo/bin:$PATH"` していました。
3. Node.js 22(旧 PC は 22.12.0 / npm 11.4.1)。npm を使います(pnpm は使いません)。
   `cd apps/rgcs-server/ui && npm ci && npx playwright install chromium`
4. Python 3(スクリプトは標準ライブラリだけ。`python3 -I` で実行)。
5. macOS なら `brew install mediamtx ffmpeg poppler`(映像の `--video` と、航空日誌 PDF の受け入れテストに使う `pdftotext`)。
6. Docker(Docker Desktop など)。Pi 向けビルド(`scripts/build-pi.sh`)と Pi 相当環境(`scripts/pi-sim.sh`)も Docker を使います。
7. ArduPilot(自社フォーク)を clone し、**サブモジュールも取得**します。
   ```sh
   git clone <自社フォークの URL> ~/github/rtos/ardupilot
   git -C ~/github/rtos/ardupilot submodule update --init --recursive
   ```
   - 旧 PC の dev スタックは upstream master(Copter 4.7-dev、2026-10-20 の `dc78bc54b8`)を使っていました。
     Copter 4.7 以降でないと NAV_ARC_WAYPOINT などが使えないためです。
   - フォーク側のチェックアウトは `d03b3d6`(2025-11)でした。フォークのブランチが古い場合は、
     upstream master を取り込んだブランチを使ってください(使うのは SITL のビルドだけです)。
8. Docker で SITL をビルドします(初回 10〜20 分。copter / plane / rover)。
   ```sh
   scripts/sitl-docker.sh build                 # ARDUPILOT_DIR=<checkout> で場所を変えられる
   ```
   成果物は `.dev/sitl-docker/build/`(git 管理外)。ArduPilot を更新したら build をやり直します。
9. dev スタックを起動します。
   ```sh
   scripts/dev.sh --docker --sitl 1 --quadplane --plane --rover --siyi-sim --video
   ```
   - UI は http://127.0.0.1:5173 で、ログインは admin / admin です。
   - UAV-01 コプター、UAV-02 QuadPlane、UAV-03 Plane、UAV-04 Rover。ホームは上高地(36.2509, 137.6385, 1505 m)から 100 m ずつ北です。
   - Ctrl-C でコンテナも含めて止まります。
10. テストを流して確認します(§3 の既知の失敗を除いて通るはずです)。
    - `cargo test --workspace`、`cargo clippy --workspace --all-targets -- -D warnings`
    - UI: `cd apps/rgcs-server/ui && npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`
    - e2e: `scripts/e2e.sh`(自前のサーバーを :8010 で起動するので dev スタックと同時に動かせます)

### Docker SITL の使い方

`scripts/sitl-docker.sh` がビルド、起動、停止をまとめています。

| やりたいこと | コマンド |
|---|---|
| ビルド | `scripts/sitl-docker.sh build` |
| dev スタック(中継経由) | `scripts/dev.sh --docker ...`(内部で `run <name> <vehicle> <I> <home> --relay 14550`) |
| 単体の SITL をホストの tcp:5760 に | `scripts/sitl-docker.sh run e2e copter 0 36.2509,137.6385,1505,0 --publish` |
| 実験用の SITL(dev スタックと別) | `scripts/sitl-docker.sh run scratch6 copter 6 36.2509,137.6385,1505,0 --publish` → tcp 5820 / 5822 / 5823、RC 入力 udp 5561 |
| 止める | `scripts/sitl-docker.sh stop <name>`(コンテナ名は `rgcs-sitl-<name>`) |

- 機体の種類は `copter | quadplane | plane | rover`。SYSID はインスタンス番号 + 1(`SITL_SYSID` で変更可)です。
- `--publish` は 127.0.0.1 にだけ公開します。SITL の状態(eeprom など)は `.dev/sitl/<name>/` です。
- SITL は udpclient のアドレスにホスト名を使えないので、コンテナ内の `sitl-run` が `@host` を
  `host.docker.internal` の IPv4 に置き換えています(Linux でも `--add-host host-gateway` で動きます)。
- `scripts/e2e.sh --with-sitl` は tcp:5760 の SITL を 1 台使います。dev スタックを止め、上の「単体の SITL」で起動してから流します。
- AI 緊急介入の SITL ハーネス(`tests/sitl/guard_toilet_bowl.py`)は実験用の SITL(-I6 / -I7)を相手にします。dev スタックのポートには触れません。

## 3. 作業のルール(ユーザーとの約束)

Claude Code はリポジトリ直下の `CLAUDE.md` を自動で読みます。同じ内容をここにも書きます。

- 会話は日本語。コード、コミットメッセージ、コード内コメントは英語。
- `.claude/`、`auto.crt`、`auto.key` はコミットしない。
- コミットは Conventional Commits(`feat:` `fix:` など)。push はユーザーが行う。
- TDD: テストを先に書き、失敗を確認してから実装する。
- ファイルは通常 400 行以下(最大 800 行)、関数は 50 行未満、状態はイミュータブル。
- `window.confirm` は使わない(アプリ内の確認ダイアログを使う)。
- アイコンは Lucide だけ。文字のグリフをアイコン代わりにしない(`src/test/no-glyph-icons.test.ts` が検査)。
- `styles/prototype.css` は `scripts/sync-css.py` が生成するので手で編集しない。prettier は実行しない(手整形のコード)。
- 頼まれない限り、機体へのコマンド送信やパラメータの書き込みはしない。ミッションのアップロードも書き込みに当たるので、ユーザーに任せる。
- dev スタックのポートには直接触らない: 5760〜5793、8000、5173、14550、14551、37260。実験用の SITL はインスタンス 6 / 7 を使う。
- プロセスはパターンで kill しない(pkill 禁止)。PID を指定して止める。
- SITL のホームは上高地: 36.2509, 137.6385, 1505。
- curl でサーバー API を叩くときは `X-Requested-With: rgcs` ヘッダが必要。`POST /api/auth/login`(admin / admin)で Cookie を取る。
- AI 関連のテストで本物の LLM を呼ばない。API キーをログ、出力、コミットに出さない。
- 外部データ(気象など)のテストで本物のインターネットに出ない(fixture とローカルの偽サーバー)。SITL の故障注入は実験用の SITL だけで行う。
- 負荷が高いと UI テストが 5 秒で時間切れになることがある。そのときは `--testTimeout=30000` で流し直す。

## 4. Claude Code のメモリを復元する

旧 PC のメモリは `claude-memory/` にそのまま写してあります。新しい PC では次の場所に置くと、Claude Code が読み込みます。

```sh
SLUG=$(echo "$HOME/github/rtos/r2s-gcs" | sed 's#/#-#g')     # 例: -Users-<you>-github-rtos-r2s-gcs
mkdir -p ~/.claude/projects/$SLUG/memory
cp docs/handoff/claude-memory/*.md ~/.claude/projects/$SLUG/memory/
```

- `r2s-gcs-dev-environment.md` は旧 PC の事情(ネイティブ SITL、`ardupilot-latest` ワークツリー、Bash の cwd の癖など)を書いています。
  新しい PC では SITL が Docker になるので、落ち着いたら書き換えてください。
- `~/.claude/rules/*.md`(コーディングスタイル、git、テストなどの全体ルール)はユーザー個人の設定で、このリポジトリには入っていません。必要なら別途コピーしてください。

## 5. 残課題

### ユーザーの判断待ち
- スマートフォン幅への対応(UX-01)。今は 1280 px 以上のデスクトップ GCS として作っていて、対応するかを確認中です。

### UI/UX 見直しで残したもの(`reviews/2026-10-26-uiux-fix-report.md`)
- UX-47 ネットワーク図の未構成の列をたたむ(レイアウトエンジンの変更になるので見送り)
- UX-56 設定欄をフォーカスが外れたときに保存する(複数フォームの保存動作の変更なので見送り)
- UX-30 一部: その機体で飛べないコマンドを含むミッションに印を付ける(保存済み一覧に項目データがない)
- UX-35 一部: Rover の 3D 表示の高度ポール
- UX-38 一部: 0 の遅延や半径の欄を省く
- 画面外チェックがサイドパネルを考慮していない

### AI 緊急介入(`reviews/2026-10-26-ai-guard-*.md`)
- 最終レビューの minor 14 件
- QuadPlane の QHOVER への切り替えは SITL で実地確認していない
- トイレットボウル検知のしきい値を実機ログで調整する

### その他
- `rgcs-camera` の `mavlink_cam::driver::tests::link_loss_disconnects_and_rebinds` が main でも毎回失敗する(既存の不具合)。
- 負荷が高いときに不安定な UI テスト: `DailyTab.test.tsx` の `saves_a_run_with_results_and_shows_the_ng_hint`、測量パレットのテスト 2 件。
- 3D 地図: DEM が読み込まれるまでは機体を `alt_msl` で描く(`vehicleAir.ts` の `vehicleModels`)。
- 運用画面の地図が起動時に機体の場所へ寄らない(既定の位置のまま)。
- 各機能の最終レビューで残した minor: `reviews/` の GPS ROI(M1〜M10)、MT11 カメラ、MAVLink カメラ、ネットワーク表示、AI チャット。
- 実機での確認: MT11 のサーマル / AI 追尾 / エンコード、MAVLink カメラのズーム / フォーカス、ROI のゲイン、実際の Pi でのリハーサル。
- フェーズ 2: ノード側 / クラウド対応のアプリ(AI チャットは実装済み)。

## 6. 移さなくてよいもの

- `auto.crt` / `auto.key`: MediaMTX が自動で作る自己署名証明書です。新しい PC で自動的に作り直されます。
- `.claude/`: この PC だけのローカル設定です。
- `.dev/`: 実行時のファイル(ログ、SITL の状態、設定)。dev 用のデータベース(保存したミッション、航空日誌など)も残したい場合だけ `.dev/data/` をコピーします。
- `target/`、`node_modules/`、`dist/`: 新しい PC でビルドし直します。
