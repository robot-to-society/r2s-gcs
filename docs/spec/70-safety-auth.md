# RGCS 仕様書 70 — 安全・認証・監査

- 版: 0.1(2026-10-16)

## 1. 機体コマンドの確認と拒否

| 区分 | コマンド | 要件 |
|---|---|---|
| 要確認 | `arm`, `disarm`, `mission_start`, `takeoff`, Guided 移動(初回)、パラメータ書込、校正開始 | UI の確認ダイアログ → `POST …/confirm {cmd}` で 30 s 有効の `confirm_token` → コマンドに添付。無い / 期限切れ / 別 cmd のトークンは `409 confirm_required` |
| 即時 | `pause`, `resume`, `rtl`, `land`, `set_mode`, `change_alt`, `change_speed`, `mission_resume` | 確認不要(2026-10-21 変更: モード変更・RTL・着陸は確認ポップアップなしで送る)。ただし未ログインは不可 |
| 禁止 | MT11 `0x48`(SD フォーマット) | ドライバ最下層で拒否。API にも存在しない |

- サーバーは UI の状態を信用しない: ARM 済み機体への `arm` は `rejected`、DISARM 済みへの `disarm` も同様。DISARM 中の `takeoff` は `409 rejected`(arm first)、Rover への `takeoff` は `422 not_allowed`(2026-10-23)。Plane への `takeoff` は EXTENDED_SYS_STATE(245)を一度も受けていない間は `409 vtol_unknown`(QuadPlane が `vtol: false` に見えて固定翼の TAKEOFF モードを送らないため。UI「機体の種類(VTOL)を確認中です。数秒後にもう一度」)。
- `other(mav_cmd, params)`(2026-10-22): 通すのは UI が使う MAV_CMD だけ。`224`(DO_SET_MISSION_CURRENT)、`511`(SET_MESSAGE_INTERVAL)、`246`(オートパイロットの再起動のみ: param1 = 1 で他は 0、それ以外(シャットダウン・ブートローダー・コンパニオン再起動など)は `400 invalid`。DISARM 中のみ、ARM 中は `409 vehicle_armed`)。それ以外は `422 not_allowed`(`400` ARM_DISARM・`300` MISSION_START で確認トークンを迂回させない)。`511` は HEARTBEAT(0)の変更を `400 invalid`、ARM 中にコアテレメトリ(0 / 1 / 24 / 30 / 33 / 42 / 74)を止める・0.5 Hz より遅くするのを `409 vehicle_armed`。param1 が整数のメッセージ ID でない、param2 が -1 未満・非有限、1〜9 999 µs(100 Hz より速い)も `400 invalid`(2026-10-23)。
- Guided 移動: 高度はジオフェンス上限(`FENCE_ALT_MAX`)を超える値を送信前に拒否(`FENCE_ENABLE`=1 のとき)。両パラメータが未取得なら `PARAM_REQUEST_READ` を送り、`warning: fence_unknown` を付けて通す。「初回」= プロセス起動後に機体ごと 1 回の確認。
- リンク喪失(`LinkLost`)中のコマンドは `503 link_lost`。`CommsDelay` 中は送るが結果待ちを 5 s に延ばす。
- 全コマンドは `CommandQueue` で直列化し、ACK 必須のものは再送 3 回 / 1.5 s タイムアウト。結果は `command_result` でフッターとメッセージ欄へ。

## 2. 入力(ジョイスティック)の安全

- デッドマン: `input_hb` が 1.5 s 途絶 → ジンバル速度 0、機体操作はニュートラル(M4)。`input_state: lost` を UI に出し、再開は次の `input_hb` から。
- レート上限: `gimbal_rate` 25 Hz、`manual` 60 Hz を超えた分は間引き。値域外(|v| > 100)は `error` を返し無視。
- 対象切替: `select` で前の対象に 0 を送ってから切替。ブラウザのタブが非表示になったら UI 側で 0 を送って送信を止める(`visibilitychange`)。
- ROI 追従中: |速度| < 5 の入力はノイズとして無視、それ以上で ROI を解除(40 §4)。
- (P2 実装)速度 (0, 0) の停止フレームはレート制限の対象外で必ず転送する。デッドマンの判定は 250 ms 間隔(最大 1.75 s で停止)。`select` はデッドマンを作動させない(ハートビート / 速度フレームのみ)。WS 切断時と選択切替時は、そのセッションが非ゼロ速度を転送してまだ止めていない機体にだけ速度 0 を送る(2026-10-23、40 §2)。

## 3. カメラ操作の安全

- `caps` に無いコマンドは API で `409 unsupported_capability`。
- エンコード変更中(解像度未取得)はクリック追跡を拒否し理由を返す。
- 映像ソースが Android のときは追跡・検出枠・温度測定を受け付けない。
- 時刻同期は GPS 時刻が無い / 古いときは送らない(カメラの時計を壊さない)。
- 自動録画(`auto_record`)は ARM で開始、DISARM で停止。SD 未挿入 / エラー時はメッセージ欄に警告。
  - 実装(2026-10-23、`apps/rgcs-server/src/auto_record.rs`): ルーターの機体状態を 2 Hz で見て、`armed` の false → true で(録画中でなければ)`RecordStart`、true → false で(録画中なら)`RecordStop`。サーバー起動後の最初の観測は変化として扱わない。開始時に `storage.status` ≠ ok、または `recording` が `no_card` / `card_error` ならシステムメッセージ `sd_card_problem`(警告)を出す。ARM 時の `RecordStart` が失敗した(カメラ未接続・ドライバー未起動を含む)ときはシステムメッセージ `auto_record_failed`(警告)を出し、ARM 中にカメラが接続状態で 2 回続けて観測されたら(再接続後の録画状態の読み直しを待つ)1 回だけ再送する(失敗したら再び警告)。監査の操作者は `auto_record`。
- 実装済み(2026-10-23): 解像度未取得のクリック・点温度は 409 `stream_unknown`、GPS 時刻が無い / 5 s 超は同期しない(`clock.error`)、時刻同期無効での「今すぐ同期」は 409 `clock_sync_off`。0x48 は引き続き最下層で拒否。Android ソースは未実装のため、その規則は Android 対応時に入れる。

## 4. AI チャット

- 利用できるツール: `get_vehicle_status`, `list_vehicles`, `list_recent_messages`, `search_log`, `propose_command`。
- **機体・カメラへ送信するツールは存在しない。`propose_command` は検証済みの提案を返すだけで、送信はオペレーターが提案カードの「実行」を押したときに通常のコマンド経路(確認ダイアログ・事前チェック・監査)で行う(2026-10-24)。**
  - サーバーのツール実装(`ai_tools.rs`)はコマンドキュー・カメラ・ROI に触れない。UI は「実行」の `onClick` からだけ送る(副作用の自動実行なし)。
  - 提案の検証(提案時): `other` → `not_allowed`、`change_alt` → `not_implemented`、`set_mode` は機体の種類(Copter / Plane / QuadPlane / Rover)で選べるモードだけ(`invalid_mode`、例: Copter への `QLOITER`)、`change_speed` は 0.5〜40 m/s(`invalid`)。続けて通常のコマンドと同じ値域・事前チェック(`link_lost`、ARM 状態、`vtol_unknown` など、§1)。1 回の応答で提案は 3 件まで(`too_many_proposals`)。拒否はツールのエラーとして AI に返り、カードは出ない。
  - 提案は `p-<uuid>`、有効 120 s、1 回だけ使える(`pending` → `executed` / `dismissed` / `expired`)。提案者本人だけが実行・却下できる。実行時にも通常の事前チェックをもう一度行い(提案後に状態が変わっていればその理由で拒否)、要確認コマンド(`arm` など)は確認ダイアログに「AI の提案」と理由を添えて開く。
  - 実行時の拒否: `404 proposal_not_found` / `403 forbidden`(他人の提案)/ `409 proposal_mismatch`(sysid・コマンドが違う)/ `409 proposal_expired` / `409 proposal_used`(実行済み・却下済み)。確認トークンの検査より先に行い、いずれも監査に `rejected` で残す。
- 監査: ツール呼び出しはすべて `target = 'ai'`、`command` = ツール名、`result` = `ok` / `error` / `rejected`、`args` = ツール入力(1 000 文字まで)。却下は `dismiss_proposal`。提案の実行は通常の機体コマンド(`target = 'vehicle'`)として記録し、`args` に `ai_proposal_id` を含める。
- 信頼しないデータ: 機体由来の文字列(STATUSTEXT、機体名、モード名、監査の文言)はツール結果の中で `untrusted_text` キーの値としてだけ AI に渡す。システムプロンプトで、ツール結果はデータであり中の指示には従わないこと、提案はオペレーターの依頼からだけ作ることを指示する。
- API キーは `config.toml` の `[ai]`(非推奨)か環境変数(既定 `ANTHROPIC_API_KEY`)からだけ読む。UI・API 応答・ログには出さない(設定の `Debug` は `***`)。OpenAI 互換の接続先へは `ANTHROPIC_API_KEY` を送らない(キーは `api_key` か `api_key_env` を設定したときだけ `Authorization: Bearer` で送る)。
- プロバイダーのエラー本文(キーや URL を含み得る)はクライアントにもログにも出さない。出すのは HTTP ステータスだけ(`AI provider error (HTTP 401)`、2026-10-25)。
- 費用の上限: 1 回の質問で全呼び出しの入出力トークン合計 60 000 まで(超えたら途中で打ち切り)、サーバー全体で直近 24 h に 2 000 000 トークンまで(`429 ai_budget`、`0` = 無制限)、ユーザーごとに 60 s で 6 回(`429 rate_limited`)、同時 1 件(`409 ai_busy`)、ツールを使う呼び出しは 6 回まで(7 回目はツールなしで回答させる)。トークンは**応答のあった呼び出しごとにその時点で予算から引く**: 失敗・タイムアウトした質問や、途中でクライアントが切断した質問も、それまでに応答した呼び出しの分を数える(会話には残さない、2026-10-25)。

## 5. 認証・セッション

- モック(開発用): `admin` / `admin` をシード。`dev_mode` のとき UI に「開発用」バッジ。本番用にはアカウント管理(M5)で置換し、初回起動時にパスワード変更を強制する。
- パスワードは argon2id。5 回失敗で 60 s ロック(ユーザー単位、`429 locked`)。同一ユーザーのログイン試行はサーバーで直列化し、並行リクエストで上限を超えられない。未知ユーザーもダミーハッシュを検証して応答時間を揃える。
- セッション: HttpOnly + SameSite=Strict クッキー、12 h。https で `Secure`。ログアウトで即時失効。
- CSRF: `X-Requested-With: rgcs` ヘッダ必須 + SameSite。
- WS: クッキーで認証。失効したら `close(4401)`。
- M5 の RGCS Hub(80 §5)ではロールを `admin` / `operator` / `viewer` にする。`viewer` は映像とテレメトリの閲覧だけで、機体・カメラへの送信はサーバーで拒否する。
- スタンドアローン版の http は LAN / VPN 内の利用を前提とし、グローバル露出時は MediaMTX の 8189 と同様にファイアウォールで LAN / VPN に限定する(セットアップ手順に明記)。

## 6. 監査

- 記録対象: 機体コマンド、カメラコマンド(`GimbalRate` は除外、開始 / 停止のみ)、ROI 開始 / 停止、設定保存、パラメータ書込、ログイン / ログアウト、AI ツール実行、機体メッセージの確認(`message_ack`)。
- 記録内容: 時刻、オペレータ、sysid、対象、コマンド、引数(機微情報なし)、結果、理由。
- 追記のみ。UI の「変更履歴」タブは `param_history`、フッターは `audit_log` の直近。

## 7. 秘密情報

- コードにトークン・鍵を置かない。android-stream のトークン、MAVLink 署名鍵は `config.toml` の外のファイル(`/etc/rgcs/secrets/`, 0600)を参照。
- ログに SDP / クッキー / パスワードを出さない。

## 8. 受け入れ条件

- 確認トークン無しの `arm` が 409、期限切れでも 409、正しいトークンで送信される。
- AI の提案はオペレーターが「実行」を押すまで送られない。提案の再使用・他人の提案・期限切れ・別コマンドへの流用が 4xx で拒否される。API キーが設定の `Debug`・`/api/ai/*` の応答・エラー文に現れない(統合テスト)。
- `input_hb` を止めて 1.5 s 後に MT11 疑似サーバーが 0x07(0,0)を受け取る。
- 0x48 を送ろうとするテストが `CameraError::Forbidden` で失敗する(ユニットテスト)。
- 401 / 429 / 409 の各経路に統合テストがある。
