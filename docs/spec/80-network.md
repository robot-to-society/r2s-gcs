# RGCS 仕様書 80 — ネットワーク構成

- 版: 0.1(2026-10-18)
- 状態: §1 はユーザー決定。§3 以降の閾値・API・認証の細部は案で、M5(hub)で確定する
- 画面: 10 §8(ネットワーク画面)、画像 `design_base/screenshots/glass_network*.png`
- 関連: 00 §2(配置形態)、30 §7(`--role` の記述は P6 統合後に本書へ合わせる)、50 §2.8 / §5、70 §5

## 1. 決定事項(2026-10-18)

- **構成は 1 つ**。スタンドアローン運用は別モードではなく、同じ構成で機体が 1 台だけ接続された状態として扱う。
- **機上ノード**(`rgcs-node`)を各機体の companion Pi に置く。ノードは機体の中にあるので、画面でも機体と 1 つのブロックで表す。
- **RGCS Hub はクラウド**に置き、組織・アカウント・ユーザー・ロール・機体を管理する。AWS IoT Core を応用する(機体ごとに Thing と X.509 証明書、MQTT トピック、Device Shadow)。
- **機体間メッシュ通信に対応**する。機体は近くの機体を中継して地上ゲートウェイ(GW)へ届く。
- 経路は **インターネット**(LTE、GW の上り回線)と **直接波**(メッシュ、Wi-Fi)に分けて扱い、画面でも分けて描く。
- **地上操作**: 現場 PC は GW の LAN に直結し、インターネットを通らずに直接波で全機体を操作・視聴する。
- ユーザーへの映像とテレメトリは **WebRTC** で提供する(映像トラック + DataChannel)。
- **Mission Planner の接続は当面対象外**(構成図にも出さない)。

## 2. 構成要素

| 要素 | 場所 | 役割 |
|---|---|---|
| FC | 機体 | ArduPilot。SYSID 単位で識別、COMPID 1 = Autopilot、100 = カメラ、154 = ジンバル |
| 機上ノード `rgcs-node` | 機体の Pi | mavlink-router(UART ⇄ UDP)、カメラ制御、MediaMTX(RTSP → WebRTC)、ローカル Web UI、上りの選択(§3) |
| メッシュ無線 | 機体 / GW | 機体間の直接波。中継(マルチホップ)可。例: Doodle Labs Mesh Rider 2.4 GHz |
| LTE モデム | 機体(任意) | インターネットへの上り。無い機体はメッシュだけで運用する |
| メッシュ GW | 現場(地上) | メッシュの出口。光回線などでインターネットへ。現場 PC を LAN に収容 |
| 現場 PC | 現場 | 地上操作の端末(ゲームパッドもここ)。GW の LAN から直接波で操作 |
| RGCS Hub | クラウド | 組織・ユーザー・ロール・機体の管理、MQTT の中継、WebRTC のシグナリング、ログ・ミッションの保存 |
| 遠隔ユーザー | どこでも | ブラウザ。Hub 経由の WebRTC で映像とテレメトリを受ける |
| 外部サービス | インターネット | NTRIP キャスター(RTCM3)。Hub が受けて全機体へ配る |

### 2.1 機上ノードのエンドポイント(mavlink-router)

| 名前 | 種類 | 宛先 |
|---|---|---|
| `fc` | UART | `/dev/ttyAMA0` 921600 |
| `rgcs-node` | UDP | `127.0.0.1:15555`(ノード本体) |
| `mesh` | UDP | メッシュのブロードキャスト `:14560` |
| `lte` | MQTT | Hub(IoT Core)`:8883` TLS、X.509 |
| `tlog` | File | `/var/log/mavlink/` |

## 3. 経路

- **上り(クラウドへ)**: LTE が正常なら LTE → インターネット → Hub。LTE が劣化しているか、LTE が無ければ、メッシュで GW へ(最小ホップ)→ GW の上り回線 → Hub。
  - 劣化の判定(案): 遅延 500 ms 超またはロス 3% 超が 10 s 続いたら切替。復帰は 30 s 正常が続いてから(ヒステリシス)。
- **地上操作**: 各機体から GW までのメッシュ最短経路。インターネットが切れても現場の運用は続けられる。
- **MAVLink**: ノードの mavlink-router が SYSID / COMPID で振り分ける。Hub との間は MQTT トピック `rgcs/{org}/{sysid}/telemetry`(上り)/ `rgcs/{org}/{sysid}/cmd`(下り)。パラメータとミッションの版は Device Shadow で同期する。
- **映像**: 機体の MediaMTX から WebRTC。遠隔はシグナリングを Hub が持ち、直接つながらなければ TURN で中継。現場は GW 上の rgcs がシグナリングを代行する(案)。
- **RTCM**: NTRIP → Hub → 全機体(`GPS_RTCM_DATA`)。

## 4. 画面へ渡すデータ(案)

- `GET /api/network` → `NetworkTopology`:
  - `sites: [{id, name, gateway: {id, addr, uplink}, field_terminals: [{id, user, addr}], vehicles: [sysid]}]`
  - `vehicles: [{sysid, name, kind, node: {ip, version}, components: [{compid, kind, name}], lte?: {state: ok|degraded, latency_ms, loss_pct, kbps, signal}, route: {via: lte|mesh, path: [string], hops}, local_route: {path: [string], hops}}]`
  - `mesh: [{a, b, snr_db, rate_mbps}]`(`a` / `b` は sysid か `gw-<site>`)
  - `users: [{id, name, role, online, client}]`、`external: [{id, kind, addr, status}]`
- WS `network_status`: 上記の差分を 1 Hz。
- 経路(`route`, `local_route`)はノードが実際に使っている経路をサーバーが返す。プロトタイプは BFS で計算している(`netLocal()`)。
- メッシュの SNR・隣接情報の取得元は無線機の API(機種決定後に確定)。

## 5. 認証・ロール(Hub)

- ロール: `admin`(管理)/ `operator`(操作)/ `viewer`(閲覧のみ。WebRTC の映像とテレメトリだけ)。
- 利用者の認証: Amazon Cognito + MFA(案)。機体(ノード)は X.509 証明書。
- 現場 PC のローカル操作時の認証は、ノード / GW に Hub のユーザー情報をキャッシュして行う(案)。

## 6. 未決事項

- 1 台構成でもクラウド Hub を必須にするか、現場の LAN だけで完結させるか。
- GW 上で rgcs を動かし、ローカルのシグナリングと認証キャッシュを持たせるか。
- メッシュ無線の機種と、SNR・経路情報の取得方法。
- LTE 劣化の判定閾値と切替のヒステリシス(§3 の値は仮)。
- GW がインターネットにつながらない現場での RTCM の扱い。
- 複数現場の扱い(GW 間の連携、機体の現場移動)。
- MAVLink を MQTT に載せる粒度(全メッセージか間引くか)と遅延要件。

## 7. 受け入れ条件(M5)

- 機体 1 台・端末 1 台の構成と、100 機・3 現場の構成が同じソフトウェアで動く(設定の違いだけ)。
- LTE を劣化させると、ノードがメッシュ経由に切り替わり、ネットワーク画面の経路表示が 2 s 以内に追従する。
- GW の上り回線を切っても、現場 PC から全機体を操作・視聴できる。
- `viewer` は機体へのコマンドを送れない(サーバーで拒否)。
