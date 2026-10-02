# Simutrans OTRP サーバ間借りサービス 設計書（ドラフト v0.1）

> 目的: 「自分ではサーバを立てられない人」が、Web 画面から数クリックで
> Simutrans OTRP のマルチプレイサーバを立て、仲間と遊べるようにする。

---

## 1. 前提整理（Simutrans サーバの性質）

設計を左右する Simutrans 側の制約を先にまとめる。

| 性質 | 内容 | 設計への影響 |
|---|---|---|
| 1プロセス = 1ゲーム | `sim -server <port>` で起動。1プロセスで1マップのみ | ゲームごとにコンテナ1つ |
| 1ゲーム = 1 TCP ポート | 既定 13353。HTTP の SNI のような振り分けは不可 | **ノードごとにポートを払い出す**必要あり |
| ヘッドレス可能 | `BACKEND=posix` でビルドすると描画無し（`COLOUR_DEPTH=0`）、画像もメモリに載らない | サーバ専用ビルドを用意（GPU/X 不要） |
| ほぼシングルスレッド | 同期型（lockstep）。サーバが遅れると全員が遅れる | **CPU のシングルコア性能**が重要。vCPU を過剰に詰め込まない |
| メモリはマップサイズ依存 | 目安: 256² で数百MB、1024² で1〜2GB、それ以上は数GB | プラン（マップ上限）でメモリ上限を決める |
| バージョン完全一致が必須 | クライアントとサーバの OTRP バージョン・pakset が一致しないと接続不可 | **バイナリのバージョン管理**と pakset 管理が DB の中心 |
| セーブ = 唯一の永続データ | `autosave`、`server_save_game_on_quit=1`（SIGTERM 時に保存） | セーブをオブジェクトストレージへ退避すればコンテナは使い捨てにできる |
| 誰もいない時は止められる | `pause_server_no_clients=1` | 無人時の CPU 消費を抑えられる → 詰め込み密度が上がる |
| 遠隔管理 | `nettool`（kick/ban/say/shutdown/force-sync/lock-company 等）、`-server_admin_pw` | Web 管理画面から nettool 相当を叩く |
| 公開リスト | `server_announce=1` で servers.simutrans.org に掲載 | サーバごとに公開/非公開を選択 |

**注意点（OTRP 固有）**
- `network/otrp_log_sender.cc` は `env_t::otrp_statistics_log` が空でなければ起動時に外部へ HTTP 送信する
  （既定は空。値はユーザーディレクトリの設定ファイルに保存される）。
  ホスティング環境では毎回まっさらな設定で起動し、空のままであることを保証する。
- `OTRP_VERSION_MAJOR` が変わるとセーブ互換が切れる。サーバ作成時に選んだバージョンを固定し、
  アップグレードは利用者の明示操作にする。

---

## 2. 全体アーキテクチャ

```
                ┌───────────────────────────────────────────┐
  利用者(ブラウザ) │  Web ポータル（管理画面）                     │
  ───────────────▶│  ログイン / サーバ作成 / 起動停止 / セーブDL    │
                └──────────────┬────────────────────────────┘
                               │ HTTPS (REST)
                ┌──────────────▼────────────────────────────┐
                │  コントロールプレーン API                      │
                │  ・認証(Discord OAuth)  ・権限               │
                │  ・スケジューラ(どのノードに置くか)             │
                │  ・ジョブキュー(起動/停止/バックアップ)         │
                └───┬──────────────┬──────────────┬─────────┘
                    │              │              │
             ┌──────▼─────┐  ┌─────▼──────┐  ┌────▼──────────────┐
             │ PostgreSQL │  │ オブジェクト  │  │ ゲームノード(VPS) × N │
             │ (メタデータ) │  │ ストレージ   │  │ ┌──────────────┐  │
             └────────────┘  │ セーブ/pak   │◀─┤ │ node-agent    │  │
                             └────────────┘  │ │ (Docker 操作)  │  │
                                             │ ├──────────────┤  │
  プレイヤー(Simutrans クライアント)            │ │ sim コンテナ ×M │  │
  ──────── TCP host:13353〜 ─────────────────▶│ └──────────────┘  │
                                             └───────────────────┘
```

### コンポーネント

| コンポーネント | 役割 | 技術候補（推奨） |
|---|---|---|
| Web ポータル | UI | SvelteKit or Next.js（静的配信可なら Cloudflare Pages） |
| API | 認証・CRUD・スケジューリング・ジョブ | **Go**（単一バイナリで運用が楽、agent と言語統一） |
| node-agent | 各ノードで常駐。API からの指示でコンテナ起動/停止、セーブ監視・アップロード、nettool 中継、メトリクス報告 | Go + Docker Engine API |
| ゲームコンテナ | `sim -server` を実行 | OTRP posix ビルドの Docker イメージ（バージョンごとにタグ） |
| DB | メタデータ | PostgreSQL 16 |
| オブジェクトストレージ | セーブ、バックアップ、pakset 配布物 | **Cloudflare R2**（転送料無料）/ S3 互換なら何でも可 |
| 監視 | 死活・リソース | Prometheus + Grafana（小規模なら Uptime Kuma）、Discord Webhook 通知 |

agent ↔ API の通信は **agent からの outbound 接続（ポーリング or WebSocket）** にする。
ノード側で管理ポートを開けずに済み、ファイアウォールはゲーム用ポート範囲のみ公開でよい。

---

## 3. クラウド/インフラ選定

### 評価軸
1. **月額の予測可能性**（趣味の共同運営なので従量課金の青天井は避けたい）
2. **日本からのレイテンシ**（lockstep なので 100ms を超えると体感が悪化）
3. **転送量課金の有無**（セーブ配布・pak 配布で地味に効く）
4. **シングルコア性能**

### 候補比較

| 候補 | 月額目安 | 日本リージョン | 転送料 | 評価 |
|---|---|---|---|---|
| **国内 VPS**（さくらの VPS / ConoHa VPS / Xserver VPS / KAGOYA 等） | 4〜8GB で ¥2,000〜5,000 | ◎ | 基本無料 | **本番の第一推奨**。定額・低遅延・転送無料 |
| **Oracle Cloud Always Free**（Ampere A1: 4 OCPU / 24GB） | ¥0 | ◎（東京/大阪） | 10TB/月無料 | **検証・初期運用に最適**。ただし ARM ビルド必須、無料枠の在庫切れ・アカウント停止リスクあり |
| Hetzner Cloud | 安い（CPX/CAX） | ✕（最寄りはシンガポール） | ほぼ無料 | 安いが日本から遅延 70ms 前後。海外ユーザー向けなら有力 |
| AWS / GCP / Azure | 常時稼働だと高い | ◎ | **高い** | 本用途には不向き（Spot 等で工夫すれば可だが複雑） |
| Fly.io / Railway 等 PaaS | 中 | △ | 有料 | 任意 TCP ポート・長時間プロセスに不向きな部分あり |

### 推奨構成

- **フェーズ1（検証〜少人数）**: Oracle Cloud Free（ARM）1台に API・DB・agent・ゲームを同居。費用 ¥0。
- **フェーズ2（一般公開）**: 国内 VPS を「コントロール用 1台（小）」＋「ゲームノード N 台（4〜8GB）」に分離。
- **共通**: オブジェクトストレージは Cloudflare R2（10GB まで無料、転送料無料）。
  DB は自前 PostgreSQL（コントロール VPS 上）＋日次ダンプを R2 へ。
  マネージドにしたいなら Neon / Supabase の無料枠も可。

> どのクラウドでも動くよう、**ノードは「Docker が動く Linux VM」以上の前提を置かない**。
> これによりベンダーロックインを避け、寄付ノード（協力者の VPS を agent で参加させる）も将来可能。

---

## 4. データベース設計

### ER 概要

```
users ─┬─< oauth_accounts
       ├─< servers >── game_versions
       │      │   >── paksets
       │      │   >── nodes
       │      ├─< server_members >── users
       │      ├─< savegames
       │      ├─< server_events (監査ログ)
       │      └── port_allocations
       └─< quotas / plans
nodes ─< port_allocations
jobs (非同期処理キュー)
```

### テーブル定義（PostgreSQL）

```sql
-- 利用者
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  TEXT NOT NULL,
  plan_id       TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
  is_admin      BOOLEAN NOT NULL DEFAULT false,   -- 運営者
  banned_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_accounts (
  provider      TEXT NOT NULL,                    -- 'discord' 等
  provider_uid  TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_uid)
);

-- プラン（＝ 1ユーザーが使える資源の上限）
CREATE TABLE plans (
  id                  TEXT PRIMARY KEY,           -- 'free', 'supporter' ...
  max_servers         INT NOT NULL,
  max_running_servers INT NOT NULL,
  max_memory_mb       INT NOT NULL,               -- 1サーバあたり
  max_map_tiles       INT NOT NULL,               -- 幅×高さ の上限
  max_savegame_slots  INT NOT NULL,
  idle_hibernate_min  INT NOT NULL                -- 無人で何分経ったら休止するか
);

-- ゲームノード（VM）
CREATE TABLE nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname        TEXT NOT NULL,                  -- プレイヤーに見せる接続先(FQDN)
  public_ip       INET NOT NULL,
  arch            TEXT NOT NULL,                  -- 'amd64' | 'arm64'
  region          TEXT NOT NULL,                  -- 'jp-tokyo' 等
  total_memory_mb INT NOT NULL,
  total_cpu_milli INT NOT NULL,
  port_range_lo   INT NOT NULL DEFAULT 13400,
  port_range_hi   INT NOT NULL DEFAULT 13499,
  status          TEXT NOT NULL DEFAULT 'active', -- active | draining | offline
  agent_token_hash TEXT NOT NULL,
  last_heartbeat  TIMESTAMPTZ
);

-- ゲームバイナリ（OTRP のバージョン × アーキテクチャ）
CREATE TABLE game_versions (
  id            TEXT PRIMARY KEY,                 -- 'otrp-v50.2'
  otrp_version  TEXT NOT NULL,                    -- '50.2'
  sim_version   TEXT NOT NULL,                    -- '122.0.1'
  image_ref     TEXT NOT NULL,                    -- 'ghcr.io/xxx/otrp-server:v50.2'
  client_download_url TEXT,                       -- 利用者に案内するクライアント
  is_default    BOOLEAN NOT NULL DEFAULT false,
  deprecated_at TIMESTAMPTZ
);

-- pakset（運営が用意したもののみ。ユーザー持ち込みは将来）
CREATE TABLE paksets (
  id            TEXT PRIMARY KEY,                 -- 'pak128.japan-2024xx'
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  storage_key   TEXT NOT NULL,                    -- R2 上の配置
  sha256        TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  download_url  TEXT,                             -- クライアント用の入手先案内
  addons_allowed BOOLEAN NOT NULL DEFAULT false
);

-- ゲームサーバ（＝利用者が作る「部屋」）
CREATE TABLE servers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,
  game_version_id TEXT NOT NULL REFERENCES game_versions(id),
  pakset_id       TEXT NOT NULL REFERENCES paksets(id),
  node_id         UUID REFERENCES nodes(id),      -- 休止中は NULL 可
  port            INT,                            -- 休止中は NULL 可
  status          TEXT NOT NULL DEFAULT 'created',-- 下記ステートマシン参照
  desired_status  TEXT NOT NULL DEFAULT 'stopped',-- running | stopped（agent の収束目標）
  memory_limit_mb INT NOT NULL,
  settings        JSONB NOT NULL DEFAULT '{}',    -- simuconf 上書き値（ホワイトリスト）
  admin_pw_enc    BYTEA NOT NULL,                 -- nettool 用。KMS/鍵で暗号化
  join_password_enc BYTEA,                        -- 任意（参加パスワード運用時）
  announce        BOOLEAN NOT NULL DEFAULT false, -- 公開リスト掲載
  current_save_id UUID,                           -- 次回起動時に読むセーブ
  last_player_seen_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE server_members (
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES users(id)   ON DELETE CASCADE,
  role      TEXT NOT NULL,                        -- owner | admin | viewer
  PRIMARY KEY (server_id, user_id)
);

-- ポート払い出し（ノード内で一意）
CREATE TABLE port_allocations (
  node_id   UUID REFERENCES nodes(id),
  port      INT,
  server_id UUID UNIQUE REFERENCES servers(id),
  PRIMARY KEY (node_id, port)
);

-- セーブデータ（実体は R2）
CREATE TABLE savegames (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                     -- auto | manual | upload | on_stop
  storage_key  TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  sha256       TEXT NOT NULL,
  savegame_ver TEXT,                              -- 例 '0.122.0.50'（互換チェック用）
  game_date    TEXT,                              -- ゲーム内年月（表示用）
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 非同期ジョブ（起動・停止・バックアップ・移設 等）
CREATE TABLE jobs (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  server_id   UUID REFERENCES servers(id),
  node_id     UUID REFERENCES nodes(id),
  payload     JSONB NOT NULL DEFAULT '{}',
  state       TEXT NOT NULL DEFAULT 'queued',     -- queued | running | done | failed
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT,
  run_after   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 監査ログ（誰が kick/ban/停止したか 等）
CREATE TABLE server_events (
  id         BIGSERIAL PRIMARY KEY,
  server_id  UUID REFERENCES servers(id) ON DELETE CASCADE,
  actor_id   UUID REFERENCES users(id),
  kind       TEXT NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

ジョブキューは最初は PostgreSQL の `SELECT ... FOR UPDATE SKIP LOCKED` で十分（Redis 不要）。

---

## 5. サーバのライフサイクル

```
 created ──start──▶ provisioning ──▶ starting ──▶ running ◀──┐
                                                   │   │      │ wake(Web ボタン)
                                         stop(手動)│   │無人が N 分継続
                                                   ▼   ▼      │
                                               stopping ──▶ hibernated
                                                   │
                                                 error（再試行 / 運営通知）
```

- **起動**: スケジューラが空きのあるノード（arch 一致・メモリ空き・ポート空き）を選択
  → agent がセーブと pak をノードのキャッシュから（無ければ R2 から）取得 → コンテナ起動。
- **停止/休止**: agent が `SIGTERM`（`server_save_game_on_quit=1`）→ 生成セーブを R2 へアップロード
  → `savegames` 登録 → ポート解放。**休止中は DB と R2 にしか存在しない**ので、ノード資源を消費しない。
- **休止の判断**: agent が nettool の `clients` 相当で接続数を定期取得し、`last_player_seen_at` を更新。
  プランの `idle_hibernate_min` を超えたら休止ジョブを投入。
  → これが「間借り」を安く成立させる最大のポイント（常時稼働は全体の一部だけになる）。
- **再開時のポート**: ポート/ノードが変わり得るため、接続先は `servers.<id短縮>.example.jp` のような
  サーバ固有 DNS 名 + 案内ポートで見せる（DNS は Cloudflare API で更新）。

---

## 6. ゲームコンテナ仕様

- イメージ: `otrp-server:<OTRP version>-<arch>`。マルチステージビルドで
  `BACKEND=posix`, `MULTI_THREAD=1`, `STATIC=1`（もしくは slim 実行環境）。
- 配置:
  - `/opt/simutrans/`（バイナリ・base 資源、読み取り専用）
  - `/paks/<pakset_id>/`（ノード共有キャッシュを read-only マウント → 同じ pak を複数サーバで共有）
  - `/data/`（そのサーバ専用。セーブ、`simuconf.tab` 上書き、ログ）
- 起動例:
  ```
  sim -server $PORT -objects <pak> -load /data/save/current.sve \
      -server_admin_pw $ADMIN_PW -singleuser -use_workdir
  ```
- `settings` JSONB → 生成する `simuconf.tab` のキーは**ホワイトリスト制**
  （`server_frames_ahead`, `pause_server_no_clients`, `server_name`, `server_comments`,
  `autosave`, 経済系パラメータ 等）。任意キーは許可しない。
- 強制値: `server_save_game_on_quit=1`、`pause_server_no_clients=1`（既定）。

### 分離・セキュリティ
- 非 root ユーザー、`--read-only` ルート FS、`--cap-drop=ALL`、`--pids-limit`、
  cgroup で `--memory` / `--cpus` 制限。
- ネットワーク: inbound は割当ポートのみ。outbound は原則遮断
  （公開リスト掲載時のみ servers.simutrans.org への HTTP を許可）。
- **ユーザーがアップロードしたセーブは C++ のパーサに入る**ため、悪意あるファイルによる
  脆弱性悪用を想定してコンテナ分離を前提とする。ユーザー持ち込み pak は初期は不可
  （将来対応する場合は gVisor 等のサンドボックスを追加）。
- 管理パスワード・参加パスワードは DB 上で暗号化、Web 上でのみ表示/再生成。

---

## 7. Web ポータル機能（MVP → 拡張）

**MVP**
- Discord ログイン（日本の Simutrans コミュニティは Discord 中心のため）
- サーバ作成: 名前 / OTRP バージョン / pakset / 新規マップ or セーブアップロード
- 起動・停止・接続先表示（`host:port` コピー、必要クライアント版・pak の案内リンク）
- セーブ一覧・ダウンロード・ロールバック（任意のセーブから再開）
- 管理者機能（nettool 相当）: 接続中クライアント一覧、kick/ban、say、会社ロック解除

**拡張**
- 共同管理者招待（`server_members`）
- 定期バックアップ世代管理、休止からの自動復帰通知
- Discord Webhook（起動・停止・異常の通知）
- 公開サーバ一覧ページ（このサービス内のディレクトリ）
- 運営画面: ノード状況、強制停止、ユーザー BAN

> 新規マップ作成: Simutrans はサーバ起動時に新規マップを生成する CLI オプションが乏しいため、
> MVP では「運営が用意したテンプレートセーブ（空マップ各サイズ）」から選ぶ方式にする。
> 将来、マップ生成用の CLI オプション追加（本リポジトリ側の改修）を検討。

---

## 8. 運用・コスト見積り（ざっくり）

| 規模 | 構成 | 月額目安 |
|---|---|---|
| 検証 | Oracle Free ARM 1台（全部入り）+ R2 無料枠 | ¥0 |
| 小規模（同時稼働 〜10 サーバ） | 国内 VPS 8GB ×1（全部入り）+ R2 | ¥4,000〜6,000 |
| 中規模（同時稼働 〜40 サーバ） | 制御用 VPS 1GB + ゲーム用 8GB ×4 + R2 | ¥15,000〜25,000 |

※ 休止機能により「登録サーバ数」は同時稼働数の数倍を収容できる想定。
※ 費用負担の方法（寄付 / 支援者プラン / 完全無料で枠制限）は別途決定が必要。

**バックアップ**: DB は日次 `pg_dump` を R2 へ（7〜30世代）。セーブは R2 のライフサイクルで世代削除。
**監視**: ノード heartbeat 途絶・コンテナ異常終了・ディスク残量を Discord Webhook に通知。

---

## 9. リポジトリ構成案

| 置き場所 | 内容 |
|---|---|
| **本リポジトリ（TID_simutrans）** | サーバ用 `Dockerfile`（posix ビルド）、GitHub Actions でイメージを GHCR に push（amd64/arm64） |
| **新規リポジトリ（例: `simutrans-hosting`）** | API、node-agent、Web ポータル、DB マイグレーション、IaC（Ansible / Terraform）、docker-compose（開発用） |

ゲーム本体とサービス側はリリースサイクルが異なるため分離を推奨。

---

## 10. 実装ロードマップ

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| **P0: サーバイメージ化** | 本リポジトリに Dockerfile と CI を追加。pakset 取得スクリプト。手動 `docker run` で接続できる | クライアントから接続して遊べる |
| **P1: MVP（単一ノード）** | DB マイグレーション、API（認証・サーバ CRUD・起動停止）、agent（コンテナ制御・セーブ退避）、最小 UI | 他人がログインして自分のサーバを立てられる |
| **P2: 運用機能** | 休止/復帰、バックアップ、nettool Web コンソール、プラン制限、監視通知 | 放置しても資源を食わず、データが消えない |
| **P3: スケール** | 複数ノード・スケジューラ、ノードの draining/移設、サーバ固有 DNS、公開一覧 | ノード追加だけで収容数を増やせる |
| **P4: 発展** | 寄付ノード参加、ユーザー pak（サンドボックス）、マップ生成 CLI | — |

---

## 11. 決めてほしいこと（オープン事項）

1. **予算と費用負担**: 完全無料運営か、寄付・支援者プランを設けるか → クラウド選定とプラン設計が決まる
2. **初期クラウド**: Oracle Free で始めるか、最初から国内 VPS か
3. **想定利用者**: 日本のコミュニティ中心か、海外も含むか（リージョン・UI 言語）
4. **対応 pakset**: 最初に載せる pak（pak128.japan / pak64 / pak128 等）と配布ライセンスの確認
5. **認証**: Discord のみでよいか（X/Twitter, GitHub 等も必要か）
6. **バージョン方針**: 最新 OTRP のみか、旧バージョンも並行提供するか
7. **言語スタック**: Go（API/agent）+ SvelteKit/Next.js の案でよいか
8. **リポジトリ**: サービス本体を新規リポジトリに分けてよいか
