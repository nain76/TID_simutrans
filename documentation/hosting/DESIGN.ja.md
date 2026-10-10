# Simutrans OTRP サーバ間借りサービス 設計書（ドラフト v0.8）

> 目的: 「自分ではサーバを立てられない人」が、Discord から数コマンドで
> Simutrans OTRP のマルチプレイサーバを立て、仲間と遊べるようにする。
>
> 副目的: 運営者（オンプレ保守経験のみ）が、**クラウド構築・IaC（Terraform / Ansible）・AI を使った運用**を
> 実践を通して身につける。

## 0. 決定事項・方針（v0.8）

| 項目 | 決定 / 方針 | 状態 |
|---|---|---|
| 対象 | 日本国内のみ（海外対応しない） | 決定 |
| スペック | 最低限動けばよい（小〜中マップ、同時稼働は数台） | 決定 |
| pakset | 標準インストーラ（`get_pak.sh`）で取れるものを初期搭載。それ以外は運営が追加 | 決定 |
| OTRP バージョン | **基本は最新版のみ**。切り替えの移行期間だけ 1つ前も残す | 決定 |
| 構築順序 | **VPS 版を先に作り、AWS サーバレス版へ段階的に移行する**（§14, §15） | 決定 |
| IaC | **Terraform（箱）＋ Ansible（中身）を併用する**（§12） | 決定 |
| 運用方式 | **GitHub を唯一の正本にする（GitOps）**。サーバへの手作業変更は禁止（§13） | 決定 |
| 予算 | ¥0 〜 少額（月 ¥1,000〜3,000 程度） | **未決**（§4 のインフラ選定に直結） |
| インフラ | Terraform で VM ごと作れるサービスから選ぶ（§4） | **未決** |
| 操作 UI | **Discord Bot を主にする**。Web は作らない（必要になったら後から追加） | 提案 |
| 構成 | **1台に全部入り**（Bot・DB・ゲームサーバ） | 提案 |
| DB | **SQLite**（1台構成なら DB サーバ不要。AWS 移行時に DynamoDB へ） | 提案 |
| 言語 | **Python**（discord.py） | 提案 |
| リポジトリ | サービス用に**新しいリポジトリを作る** | 提案 |
| 認証 | Discord アカウントをそのまま使う（Bot 方式なら別途ログイン機能は不要） | 提案 |
| AI 活用 | AI は「データを読む・PR を作る」まで。本番変更は CI が人の承認後に行う（§13） | 提案 |
| セキュリティ | **侵入される前提で設計する**（消せないバックアップ、SSH 非公開、作り直しで復旧）（§17） | 提案 |
| 運営用の入口 | **SSH は Tailscale、Web 画面（Grafana 等）は Cloudflare Tunnel + Access**。公開ポートはゲーム用のみ（§17.4） | 決定 |

## 1. 前提整理（Simutrans サーバの性質）

| 性質 | 内容 | 設計への影響 |
|---|---|---|
| 1プロセス = 1ゲーム | `sim -server <port>` で起動。1プロセスで1マップのみ | ゲームごとにコンテナ1つ |
| 1ゲーム = 1 TCP ポート | 既定は 13353。HTTP のように同じポートで振り分けることはできない | サーバごとにポートを割り当てる |
| 画面なしで動かせる | `BACKEND=posix` でビルドすると描画無し、画像もメモリに載らない | サーバ専用ビルドを用意（GPU/X 不要） |
| ほぼシングルスレッド | 同期型（lockstep）。サーバが遅れると全員が遅れる | vCPU の数より 1コアの性能が重要 |
| メモリはマップサイズ次第 | 目安: 256² で数百MB、1024² で1〜2GB | プランでマップサイズの上限を決める |
| バージョン完全一致が必須 | クライアントとサーバの OTRP 版・pakset が一致しないと接続不可（pakset は接続時にチェックサムを比較） | バージョンと pakset の管理が中心 |
| セーブ = 唯一の永続データ | `autosave`、`server_save_game_on_quit=1`（SIGTERM で終了するときに保存） | セーブだけ守ればコンテナは使い捨てにできる |
| 無人なら止められる | `pause_server_no_clients=1` | 無人時の CPU 消費を抑えられる |
| 遠隔管理 | `nettool`（clients/kick/ban/say/shutdown/force-sync/lock-company 等）、`-server_admin_pw` | Bot から nettool 相当を呼ぶ |

**OTRP 固有の注意点**: `network/otrp_log_sender.cc` は `env_t::otrp_statistics_log` が空でなければ、起動時に外部へ HTTP 送信する（既定は空）。ホスティング環境では毎回まっさらな設定で起動し、空のままであることを保証する。

---

## 2. 操作 UI: Discord Bot と Web サイトの比較

| 観点 | Discord Bot | Web サイト |
|---|---|---|
| ログイン機能 | **不要**（Discord が本人確認済み） | OAuth・セッション管理・CSRF 対策などを自前で実装 |
| 画面作成 | **不要**（スラッシュコマンド・ボタン・選択メニュー） | HTML/CSS/JS の画面一式 |
| 公開に必要なもの | **なし**（Bot から Discord へ外向きに接続するだけ） | ドメイン、HTTPS 証明書、Web サーバの公開 |
| 通知 | **標準でできる**（チャンネル投稿・DM） | 別途メールや Webhook が必要 |
| セーブのアップロード | 添付ファイル（**無料ユーザーは 10MB まで**） | 大きなファイルも扱える |
| 凝った表示（グラフ等） | 苦手 | 得意 |
| 対象ユーザーとの相性 | 日本の Simutrans コミュニティは Discord 中心 | — |

**結論: Web サイトの方がずっと重い。最初は Discord Bot で作る。**
10MB を超えるセーブのアップロードだけは、Bot が発行する「期限付きアップロード URL」で対応する（小さな受付用エンドポイント1本のみ、P2 以降）。

### コマンド案

| コマンド | 内容 | 誰が使えるか |
|---|---|---|
| `/server create name: pak: size:` | サーバ作成（空マップのテンプレートから） | 誰でも（上限あり） |
| `/server import name: pak: file:` | セーブを添付して作成 | 誰でも（上限あり） |
| `/server start` / `/server stop` | 起動 / 停止（停止時に自動でセーブ） | owner, admin |
| `/server info` | 接続先 `host:port`、状態、必要なクライアント版・pak の案内 | メンバー |
| `/server save` / `/server saves` | 手動セーブ / セーブ一覧・ダウンロードリンク | owner, admin |
| `/server rollback save:` | 指定したセーブから再開 | owner |
| `/server players` | 接続中プレイヤー一覧 | メンバー |
| `/server kick` / `ban` / `say` / `unlock-company` | nettool 相当 | owner, admin |
| `/server member add/remove` | 共同管理者の追加・削除 | owner |
| `/server delete` | 削除（確認ボタン付き） | owner |
| `/admin ...` | 運営用（全サーバ一覧、強制停止、pak 追加、ユーザー BAN） | 運営ロール |

サーバ作成・ファイルの受け渡しは、Bot を導入した**専用 Discord サーバ（ギルド）内**に限定する。どのギルドからでも使える形にするかは後で判断する。

---

## 3. 全体アーキテクチャ（最小構成: 1台）

```
 Discord ユーザー ──(スラッシュコマンド)──▶ Discord
                                            ▲
                                            │ 外向き WebSocket（受け口の公開は不要）
 ┌──────────────────────────────────────────┼─────────────────┐
 │ VM 1台（§4 で選定。Terraform で作成）     │                 │
 │                                          │                 │
 │  ┌───────────────────────────────────────┴─────┐           │
 │  │ hosting-bot（Python, 常駐）                  │           │
 │  │  ・コマンド処理・権限チェック                 │           │
 │  │  ・Docker 操作（起動/停止）                   │           │
 │  │  ・定期処理（無人なら休止、バックアップ）      │           │
 │  │  ・nettool 呼び出し                          │           │
 │  └──────┬──────────────────┬───────────────────┘           │
 │         │                  │ Docker API                    │
 │   ┌─────▼─────┐   ┌────────▼───────────────────────┐       │
 │   │ SQLite    │   │ sim コンテナ ×M（ポート 13400〜）│◀──────┼── Simutrans クライアント
 │   └───────────┘   └────────────────────────────────┘       │   TCP host:port
 │   /srv/simu/paks（共有・読み取り専用）  /srv/simu/servers/<id>/  │
 └──────────────────────────────────────────────────────────────┘
         │ 日次バックアップ（DB + セーブ）
         ▼
   Cloudflare R2（無料 10GB。Terraform で作成）
```

- 1台構成なので、**ノード管理・スケジューラ・ジョブキュー・agent は作らない**（Bot が直接 Docker を操作する）。
- 将来複数台にする場合は、Bot から Docker 操作部分を「agent」として切り出す。最初から関数単位で分けておく。

---

## 4. インフラ選定

### 選定条件（v0.3 で追加）
Terraform の経験を積むため、**VM（VPS）そのものを Terraform で作れる**サービスを優先する。
VM を Terraform で作れれば、「Terraform で作る → IP を Ansible に渡す → Ansible で設定する」という
**一連の流れを全部コードで再現できる**（壊して作り直す練習もできる）。

### 候補

| 候補 | 月額目安 | Terraform | 日本 | CPU の性質 | 評価 |
|---|---|---|---|---|---|
| **Oracle Cloud Always Free**（ARM 4コア/24GB） | **¥0** | ◎ 公式プロバイダ | ◎ 東京/大阪 | 専有に近い | 予算 ¥0 なら唯一の現実解。Terraform 化すると「面倒な画面操作」が減る |
| **さくらのクラウド** | 2コア/4GB で数千円程度 | ◎ 公式プロバイダ | ◎ 国内事業者・円建て | 安定 | 国内サービスで Terraform 対応。費用はやや高め |
| **AWS Lightsail**（東京） | 2GB で $10〜12 程度 | ◎ AWS プロバイダ | ◎ 東京 | **バースト型**（使いすぎると CPU が制限される） | **将来の AWS 移行と同じアカウント・同じ Terraform で扱える**のが最大の利点。CPU 制限に注意 |
| Vultr / Akamai(Linode)（東京） | 2GB で $10〜12 程度 | ◎ 公式プロバイダ | ○ 東京リージョン | 安定 | ドル建て。選択肢としては十分 |
| 一般的な国内 VPS（ConoHa / Xserver 等） | 2GB で ¥1,000 前後 | △ 非対応が多い | ◎ | 安定 | 最安だが VM 作成は手作業になる（Terraform は DNS 等のみ） |

※ 価格は目安。契約前に公式サイトで要確認。

### 推奨（予算が決まり次第どれかに確定）

| 予算 | 推奨 | 理由 |
|---|---|---|
| ¥0 | **Oracle Always Free** | 無料で 24GB。Terraform 公式対応なので、手作業の面倒さを IaC で吸収できる |
| 少額 OK・AWS 移行を重視 | **AWS Lightsail** | 先に AWS アカウントの安全設定・Terraform に慣れておける。§15 の移行がそのまま地続きになる |
| 少額 OK・安定性を重視 | **さくらのクラウド** or Vultr | CPU 制限がなく、Simutrans の同期処理と相性が良い |

### 共通方針
- 前提は「**Docker が動く Linux 1台**」だけ。クラウド固有の機能には依存しない（乗り換え可能にする）。
- DNS とバックアップ置き場は **Cloudflare**（DNS 無料、R2 は 10GB まで無料）を Terraform で管理する。
- Terraform の状態ファイル（state）も R2（または S3）に置く（§12）。

### 収容数の目安
| VM | 同時稼働の目安 |
|---|---|
| 2GB | 小マップ 2〜3 サーバ |
| 4GB | 小〜中マップ 4〜5 サーバ |
| 24GB / 4コア（Oracle Free） | 8〜10 サーバ（CPU が先に限界） |

休止機能により、登録サーバ数はその数倍を受け入れられる。

---

## 5. データ設計（SQLite）

1台構成なので SQLite で十分。ファイル1つなのでバックアップはファイルをコピーするだけ。
複数台にする段階で PostgreSQL へ移行する（テーブル構成はそのまま移せるようにしておく）。

```sql
-- 利用者（Discord ユーザー）
CREATE TABLE users (
  discord_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_operator  INTEGER NOT NULL DEFAULT 0,       -- 運営
  banned_at    TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ゲームバイナリ（最新＋移行期間中の1つ前）
CREATE TABLE game_versions (
  id           TEXT PRIMARY KEY,                  -- 'otrp-v50.2'
  otrp_version TEXT NOT NULL,
  image_ref    TEXT NOT NULL,                     -- 'ghcr.io/xxx/otrp-server:v50.2'
  client_url   TEXT,                              -- クライアント入手先の案内
  status       TEXT NOT NULL DEFAULT 'current',   -- current | previous | retired
  released_at  TEXT NOT NULL
);

-- pakset
CREATE TABLE paksets (
  id          TEXT PRIMARY KEY,                   -- 'pak64-122-0'
  name        TEXT NOT NULL,                      -- 表示名
  source      TEXT NOT NULL,                      -- 'installer'（標準インストーラ）| 'manual'（運営追加）
  source_url  TEXT NOT NULL,                      -- 取得元 / クライアントへの案内
  sha256      TEXT NOT NULL,
  local_path  TEXT NOT NULL,                      -- /srv/simu/paks/<id>
  enabled     INTEGER NOT NULL DEFAULT 1
);

-- ゲームサーバ
CREATE TABLE servers (
  id              TEXT PRIMARY KEY,               -- 短い ID（例 'a7k2'）
  owner_id        TEXT NOT NULL REFERENCES users(discord_id),
  name            TEXT NOT NULL,
  game_version_id TEXT NOT NULL REFERENCES game_versions(id),
  pakset_id       TEXT NOT NULL REFERENCES paksets(id),
  port            INTEGER UNIQUE,                 -- 13400〜13499。休止中も保持して接続先を固定
  status          TEXT NOT NULL DEFAULT 'stopped',-- stopped | starting | running | stopping | error
  memory_limit_mb INTEGER NOT NULL,
  settings_json   TEXT NOT NULL DEFAULT '{}',     -- simuconf 上書き（ホワイトリストのキーのみ）
  admin_pw        TEXT NOT NULL,                  -- nettool 用（ランダム生成、利用者には見せない）
  announce        INTEGER NOT NULL DEFAULT 0,     -- 公開リストへの掲載
  current_save_id TEXT,
  last_player_seen_at TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE server_members (
  server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
  user_id   TEXT REFERENCES users(discord_id),
  role      TEXT NOT NULL,                        -- owner | admin | member
  PRIMARY KEY (server_id, user_id)
);

-- セーブ（実体は /srv/simu/servers/<id>/saves/ と、バックアップ先）
CREATE TABLE savegames (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                      -- auto | manual | upload | on_stop
  path        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  game_version_id TEXT,                           -- どの版で作ったか（互換チェック）
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 監査ログ（誰が何をしたか）
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id  TEXT,
  actor_id   TEXT,
  kind       TEXT NOT NULL,                       -- create / start / kick / ban / delete ...
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**制限値（初期案。設定ファイルで変更可）**

| 項目 | 値 |
|---|---|
| 1人あたりの所有サーバ数 | 2 |
| 全体の同時稼働数 | 8 |
| マップ上限 | 512×512（メモリ上限 1.5GB） |
| 無人で休止するまで | 30分 |
| 保持するセーブ数 | 1サーバあたり 自動 5 + 手動 5 |
| 未使用サーバの自動削除 | 90日起動なし → 警告 DM → 14日後に削除 |

---

## 6. サーバのライフサイクル

```
 (create) ─▶ stopped ──/server start──▶ starting ──▶ running
                ▲                                     │
                │          /server stop、または        │
                └──── stopping ◀── 無人が 30分続いた ──┘
                         （SIGTERM → 停止時セーブ → 保存）
```

- **ポートは作成時に割り当てて固定**し、停止中も保持する（1台構成なので接続先が変わらない）。100 ポートで 100 サーバまで登録可能。
- 停止中はコンテナが存在しないので、メモリも CPU も使わない。
- 無人判定: Bot が数分おきに nettool `clients` で接続数を確認し、`last_player_seen_at` を更新する。
- 「起動して」と言われたときに同時稼働数の上限に達していたら、断って待ってもらう（順番待ちは作らない）。

---

## 7. ゲームコンテナ

- イメージ: `otrp-server:<OTRP版>`（amd64 / arm64 両対応）。`BACKEND=posix`、`MULTI_THREAD=1` でビルド。
- マウント:
  - `/paks/<pakset_id>` ← `/srv/simu/paks/<id>`（読み取り専用。全サーバで共有）
  - `/data` ← `/srv/simu/servers/<id>`（セーブ、生成した `simuconf.tab`）
- 起動例:
  ```
  sim -server $PORT -objects <pak> -load /data/save/current.sve \
      -server_admin_pw $ADMIN_PW -singleuser -use_workdir
  ```
- 強制する設定: `server_save_game_on_quit=1`、`pause_server_no_clients=1`。
- 制限: 非 root 実行、`--read-only`、`--cap-drop=ALL`、`--security-opt no-new-privileges`、`--memory`、`--cpus=1`、`--pids-limit`。
- イメージはタグではなく**ダイジェスト（sha256）で固定**して起動する（すり替え防止）。
- 外向き通信は原則遮断する（公開リスト掲載時のみ許可）。
- **アップロードされたセーブは C++ の読み込み処理にそのまま渡る**ため、悪意あるファイルを想定し、コンテナ分離を必須とする。

### 新規マップについて
`sim` にはサーバ起動時に新規マップを自動生成するオプションが乏しい。そのため、**運営があらかじめ作っておいた空マップのテンプレートセーブ**（pak × サイズごと）から選ぶ方式にする。

---

## 8. pakset 管理

- **初期搭載**: このリポジトリの `get_pak.sh` は引数で番号を指定すれば対話なしで実行できるので、サーバ構築時にそれで取得する。対象は pak64 / pak128 / pak128.japan / pak64.japan 等、標準インストーラに載っているもの。
- **改ざん対策**: `get_pak.sh` の取得先の多くは **`http://`（暗号化なし）**のため、通信途中で差し替えられる可能性がある。初回に取得したファイルの sha256 を確認してコードに固定し、以後は **R2 に保管した検証済みの複製**から取得する（毎回外部から取らない）。
- **追加**: 運営が `/admin pak add url:` で URL を渡す → Bot がダウンロード・展開・sha256 を記録 → `paksets` に登録。
- **クライアント側の注意**: サーバと同じ版の pak でないと接続時に弾かれる。`/server info` で「この pak のこの版」と取得元 URL を必ず案内する。
- ユーザーによる pak・アドオンの持ち込みは当面不可（セキュリティと容量の問題）。

---

## 9. OTRP バージョン方針（最新版のみ）

```
新しい OTRP タグが打たれる
   ↓ CI がサーバ用イメージをビルド（amd64/arm64）
   ↓ 運営が /admin version add で登録 → current に昇格、旧 current は previous へ
   ↓ Discord に告知（「v51 になりました。クライアントを更新してください」）
新規サーバ: current で作成
既存サーバ: 次回起動時に current へ自動移行
            （新しい版は古いセーブを読めるのが基本。読めなかった場合は previous で起動し、owner に通知）
移行期間（例 2週間）の経過後: previous を retired にしてイメージを削除
```

- 常に存在するのは **最新 + 1つ前** の最大2つだけ → 管理がシンプル。
- `OTRP_VERSION_MAJOR` が上がると、**古い版では新しいセーブを読めない**（一方通行）。自動移行の前に必ず停止時セーブを取っておく。

---

## 10. 言語・技術スタック

| 用途 | 採用 | 理由 |
|---|---|---|
| Bot 本体 | **Python 3.12 + discord.py** | Discord Bot の情報量が最も多い。読みやすく、インフラ系の人でも追いやすい |
| Docker 操作 | `docker`（Python SDK） | 公式 SDK |
| DB | SQLite（標準ライブラリ） | 追加の構築が不要 |
| バックアップ | `boto3`（S3 互換） | R2 / S3 / Oracle どれでも同じコードで使える |
| 実行環境 | Bot 自体も Docker コンテナ、`docker compose` で起動 | 構築手順が `compose up` だけになる |
| 箱の構築（VM・FW・DNS・ストレージ） | **Terraform** | §12 |
| 中身の設定（OS・Docker・Bot 配置） | **Ansible** | §12 |
| CI/CD | GitHub Actions | plan / lint / 反映を自動化（§13） |
| 監視 | Bot 自身が異常を Discord の運営チャンネルへ投稿 + Uptime Kuma（任意） | 追加コストなし |
| 可視化（任意・O1） | Prometheus + Grafana（または Grafana Cloud 無料枠） | 運用開始後にデータを見て判断するため（§15.2） |

> Go などに比べて実行速度は劣るが、Bot がしているのは「コマンドを受けて Docker に指示する」程度なので、問題にならない。

---

## 11. リポジトリ構成

### 分けるメリット・デメリット

| | 分ける（推奨） | このリポジトリに同居 |
|---|---|---|
| ゲーム本体の PR・CI | 影響なし | Bot の変更でも Windows/Mac/Ubuntu のビルド CI が走る |
| 上流（OTRP 本家）との同期 | 衝突しない | サービス用ファイルが混ざり、取り込みや PR が汚れる |
| リリースの単位 | 別々に出せる（Bot だけ直す、など） | ゲームのタグと混ざる |
| 権限・秘密情報 | サービス側だけ非公開にもできる | ゲームと同じ公開範囲になる |
| 管理の手間 | リポジトリが2つになる | 1つで済む |
| バージョン連携 | 「どの OTRP タグを使うか」を指定する仕組みが必要 | 同じリポジトリ内で完結 |

**推奨: 分ける。**

- **TID_simutrans（このリポジトリ）**: 変更しない（または最小限）。
- **新リポジトリ（例: `simutrans-hosting`）**:
  - `image/Dockerfile` … TID_simutrans の指定タグを取得してサーバ用にビルド
  - `bot/` … Discord Bot
  - `terraform/`, `ansible/` … インフラのコード（構成は §12）
  - `docs/` … この設計書（新リポジトリ作成時に移す）
- 新しい OTRP タグを検知する仕組み: 新リポジトリの GitHub Actions で定期的にタグを確認する（または手動実行）。

---

## 12. IaC 設計（Terraform ＋ Ansible）

### 役割分担

| | Terraform | Ansible |
|---|---|---|
| オンプレで言うと | サーバ発注・ラッキング・配線・IP/DNS 払い出し | OS 構築手順書（キッティング） |
| 担当 | **箱**: VM、FW（クラウド側）、DNS、R2 バケット | **中身**: SSH 設定、ufw、自動更新、Docker、ディレクトリ、pak、Bot 配置、バックアップ cron |
| 命令先 | クラウドの API | VM に SSH |
| 記録 | state ファイル（作ったものを記憶） | なし（毎回、現状を確かめて実行） |
| 確認 | `terraform plan` | `ansible-playbook --check --diff` |
| 反映 | `terraform apply` | `ansible-playbook` |

**境界のルール**
- Terraform は VM に SSH しない（`provisioner` は使わない）。VM 内のことは全部 Ansible。
- 例外として、VM 作成時の **cloud-init で「Ansible 用ユーザーと SSH 公開鍵の登録」だけ**行う（Ansible が最初に入るための鍵）。
- Ansible はクラウドの API を触らない（箱は作らない）。

### 受け渡しの流れ

```
terraform apply
   │  VM・FW・DNS・R2 を作成
   │  output: vps_ip, ssh_user
   ▼
inventory 生成（terraform output → ansible/inventory/hosts.yml）
   ▼
ansible-playbook site.yml
   │  base → docker → simu_host → bot → backup の順に設定
   ▼
動作確認（Discord で /server create → 接続できるか）
```

inventory は Terraform の `local_file` リソースで自動生成するか、`terraform output -json` を読む小さなスクリプトで作る。
**IP を手で書き写さない**のがポイント。

### ディレクトリ構成（新リポジトリ）

```
simutrans-hosting/
├── CLAUDE.md / AGENTS.md        # AI 向けの前提・ルール（中身は共通）
├── docs/                        # この設計書、手順書、障害記録
├── image/Dockerfile             # OTRP サーバイメージ
├── bot/                         # Discord Bot（Python）
├── terraform/
│   ├── modules/
│   │   ├── vps/                 # VM + クラウド側 FW + cloud-init
│   │   ├── dns/                 # Cloudflare DNS
│   │   └── storage/             # R2 バケット（バックアップ / state）
│   └── envs/
│       ├── prod/                # 本番（main.tf, backend.tf, variables.tf, outputs.tf）
│       └── staging/             # 練習・検証用（使う時だけ作って、終わったら destroy）
├── ansible/
│   ├── inventory/               # Terraform から生成（Git 管理しない or 生成物として管理）
│   ├── group_vars/              # 変数。秘密情報は ansible-vault で暗号化
│   ├── site.yml                 # 全ロールをまとめて実行
│   └── roles/
│       ├── base/                # SSH は鍵認証・Tailscale 経由のみ、ufw、unattended-upgrades、fail2ban、auditd、時刻同期
│       ├── tunnel/              # （O1 以降）cloudflared。Web 画面を Cloudflare Tunnel で公開
│       ├── docker/              # Docker Engine と compose
│       ├── simu_host/           # /srv/simu 配下、get_pak.sh で pak 取得、テンプレートセーブ
│       ├── bot/                 # compose.yaml と .env を配置して起動
│       ├── backup/              # rclone で R2 へ日次バックアップ（削除できないバケットへ。§17）
│       └── monitoring/          # （任意・O1）node_exporter / cAdvisor / Prometheus / Grafana
└── .github/workflows/           # §13
```

### state と秘密情報

| 対象 | 置き場所 | 注意 |
|---|---|---|
| Terraform state | R2（S3 互換 backend）または S3 | **ローカルに置かない**（PC が壊れると管理不能になる）。中に IP などが入るので公開しない |
| クラウドの API トークン | 手元: 環境変数 / CI: GitHub Secrets（Environments） | 権限を最小にしたトークンを作る |
| Bot トークン、LLM API キー | ansible-vault で暗号化して Git 管理 → VM の `.env` に展開 | 平文でコミットしない |
| SSH 秘密鍵 | 手元のみ。**パスフレーズ必須**、可能なら FIDO2 セキュリティキー（`ed25519-sk`） | CI には渡さない（反映は VM からの取得方式） |
| ansible-vault のパスワード | パスワードマネージャのみ | Git・手元の平文ファイルに置かない |

### 守るルール
1. **本番 VM に SSH して設定を手で変えない**（調査のためのログイン・閲覧は可）。変えたい時はコードを直す。
2. Ansible は **2回目の実行で `changed=0` になること**を確認する（同じ手順を流しても結果が同じ = 冪等）。
3. `terraform plan` に**想定外の「destroy（削除）」が出たら止まる**。
4. 練習は `envs/staging` で行い、終わったら `terraform destroy` で消す（費用も節約）。
5. API トークンは**用途ごとに分け、必要最小の権限・対象に絞る**（例: VM のバックアップ用は「そのバケットだけ」）。

---

## 13. 開発・運用の流れ（GitOps ＋ AI）

### 中心は GitHub
すべての変更・記録・判断を GitHub に集める。ツールが増えても、流れは変えない。

| ツール | 役割 | 人が触るか |
|---|---|---|
| GitHub | 唯一の正本（コード・設計書・Issue・PR・履歴） | ◎ レビューとマージ |
| Claude Code | 調査、コード作成、PR 作成、CI 失敗の修正 | ◎ 依頼する |
| GitHub Actions | lint / plan / check、反映、通知 | ✕ 自動 |
| Terraform / Ansible | 実際の変更 | ✕ Actions から実行 |
| Discord | 利用者の操作、運営への通知 | ○ 見る |
| LLM API（Bot 内） | ログ要約・障害の一次分析 | ✕ 自動 |
| Dots（任意） | 秘書役（週次まとめ、レビュー待ちの催促など）。**読み取り権限のみ** | ○ |

### CI（GitHub Actions）

| きっかけ | 実行内容 |
|---|---|
| PR 作成・更新 | `terraform fmt -check` / `validate` / **`plan` の結果を PR にコメント**、`ansible-lint`、`--syntax-check`、Bot のテスト |
| main へマージ | `terraform apply` → `ansible-playbook`（GitHub Environments で**承認ボタンを押してから**実行） |
| 定期（毎日） | `terraform plan` で**手作業による差分（ドリフト）が無いか確認**、新しい OTRP タグの確認 |
| 反映完了・失敗 | Discord の運営チャンネルへ通知 |

反映の自動化は段階的に進める:
1. 最初は**手元の PC から**手で plan / apply / ansible を実行（仕組みを体で覚える）
2. 次に **PR で plan / lint だけ自動**
3. 慣れたら **マージ後の反映も自動**（承認ボタン付き）

### 障害対応の流れ

```
① Bot が異常を検知 → Discord 運営チャンネルに通知
                    → GitHub Issue を自動作成（ログ末尾 + AI の要約を添付）
② 人: Claude Code に「この Issue を調べて直して」と依頼
   Claude Code: Issue とリポジトリを読む → 修正 → PR
③ Actions: テスト / plan / check の結果を PR にコメント → 人がレビューしてマージ
④ Actions: 承認後に反映 → Discord に完了通知
```

### AI に渡さないもの
本番 VM の root / SSH 鍵、Docker の操作権限、Bot トークン、Terraform の apply 権限。
AI は「データを読む」「PR を作る」まで。反映は**人の承認後に CI が行う**。

---

## 14. 将来: AWS サーバレス版（概要）

VPS 版で運用経験を積んだ後、段階的に移行する。

| 役割 | VPS 版 | AWS 版 |
|---|---|---|
| コマンド受付 | Bot 常駐プロセス | Lambda（Discord Interactions の HTTP 方式） |
| 手順の段取り | Bot 内の Python | Step Functions |
| 定期処理・イベント | Bot 内タイマー / Docker イベント | EventBridge |
| ゲーム実行 | Docker（ポートで区別） | ECS Fargate（Spot 可。タスクごとに IP、DNS で固定名） |
| DB | SQLite | DynamoDB |
| ファイル | ローカル + R2 | S3 |
| AI | LLM API | Bedrock（IAM で読み取り専用に制限） |
| IaC | Terraform + Ansible | **Terraform のみ**（サーバが無いので Ansible の出番は減る） |

**移行時に流用するもの**: ゲームのコンテナイメージ、Discord コマンド仕様、データの形、運用で得た知見。
そのため Bot は「Docker 操作部分」「DB 部分」を**差し替え可能な作り**にしておく。

---

## 15. ロードマップ（学習を兼ねる）

### 15.1 本線（必須）

| 段階 | 内容 | 身につくこと | 完了条件 |
|---|---|---|---|
| **S1 準備** | GitHub 新リポジトリ、クラウド・Cloudflare アカウント、MFA、予算アラート。手元に Terraform / Ansible を導入（Windows なら WSL） | アカウント管理の基本 | 各サービスに安全にログインできる |
| **S2 Terraform 入門** | Cloudflare の DNS レコード1件だけを Terraform で作る → plan → apply → destroy。state を R2 に置く | **Terraform の基本サイクル**、state | 作って消すのを3回繰り返せる |
| **S3 箱を作る** | `modules/vps` で VM と FW を作成、cloud-init で Ansible 用ユーザー登録、inventory 自動生成 | Terraform のモジュール、output | `terraform apply` 1回で SSH できる VM ができる |
| **S4 中身を作る** | Ansible `base` / `docker` ロール | **Ansible の基本**、冪等性 | 2回目の実行で `changed=0` |
| **S5 手動で遊ぶ** | Docker で Simutrans サーバを**手で**起動し、手元クライアントから接続 → 手順を `simu_host` ロールに落とし込む | Docker、「手作業 → コード化」の流れ | Ansible だけでゲームサーバが立つ |
| **S6 Bot 最小版** | create / start / stop / info / delete（コードは Claude Code が作成、人がレビュー） | PR レビュー、Python を読む力 | 他の人が Discord だけでサーバを立てられる |
| **S7 運用機能** | 無人時の自動停止、セーブ一覧・ロールバック、R2 バックアップ（`backup` ロール）、kick/ban/say、上限チェック、異常通知（Discord + GitHub Issue 自動作成）、Uptime Kuma | 運用設計 | 放置しても資源を食わず、データが消えない |
| **S8 CI 化** | PR で plan / lint、マージ後の反映（承認付き）、毎日のドリフト検出、Discord 通知 | **GitOps**、GitHub Actions | 手元から apply しなくなる |
| **S9 復旧訓練** | staging 環境を Terraform + Ansible で**ゼロから作り、バックアップから復元**→ 所要時間を記録 → destroy | 障害復旧（DR）、IaC の真価 | 手順書なしで○分以内に復旧できる |
| ── **一般公開・運用開始** ── | | | |
| **S10 AWS 移行** | ① AWS の安全設定 → ② バックアップ先を S3 へ → ③ AI レポートを Bedrock へ → ④ 管理部分を Lambda + DynamoDB へ → ⑤ ゲームを Fargate へ（すべて Terraform） | AWS、IAM、サーバレス | VPS を解約しても動く |

各段階は「元に戻せる状態」を保ったまま進める。S9 の復旧訓練は、本番公開前に必ず一度行う。

### 15.2 任意の追加（オプション）

本線とは独立していて、**やらなくてもサービスは動く**。前提条件を満たした後なら、好きな時期に差し込める。

| 段階 | 内容 | 前提 | おすすめ時期 | 身につくこと | 完了条件 |
|---|---|---|---|---|---|
| **O1 可視化** | Ansible `monitoring` ロール（node_exporter / cAdvisor / Prometheus / Grafana / Alertmanager → Discord）。Grafana は **Cloudflare Tunnel + Access** 経由で公開（`tunnel` ロール、Access の設定は Terraform）。Bot に `/metrics`（稼働サーバ数・サーバ別の接続人数・起動時間・停止理由）を追加 | S7、S8（GitOps で入れるため） | **運用開始から2〜4週間後**（データが溜まり始めてから意味が出る） | Prometheus / PromQL / Grafana、メトリクス設計 | ダッシュボードで「サーバ別のメモリ・CPU・人数」の推移が見られる |
| **O2 AI 週次レポート** | Bot 内の LLM API で、1週間の稼働・エラー・費用・（O1 があれば）グラフの数値を要約し運営チャンネルへ | S7 | O1 の後だと内容が具体的になる | LLM API の使い方、AI に渡すデータの設計 | 毎週月曜にレポートが届く |
| **O3 Dots 秘書** | GitHub 読み取りのみで、週次まとめ・レビュー待ちの催促・料金/規約変更の見張り | S8 | 予算に余裕が出たら | 新しい AI エージェントの評価 | 本番権限を渡さずに役に立っている |

**O1 の構成の選び方**

| VM のメモリ | 構成 | 理由 |
|---|---|---|
| 8GB 以上（Oracle Free など） | Prometheus と Grafana も VM 上で動かす | 一式で数百MB。余裕がある |
| 2〜4GB | **Grafana Cloud の無料枠**を使い、VM には送信用エージェント（Grafana Alloy）だけ置く | ゲームサーバにメモリを残す。無料枠の範囲は要確認 |
| AWS 移行後 | CloudWatch に置き換え（Prometheus 互換のマネージドサービスもあるが有料） | — |

**O1 で判断できるようになること**: 同時稼働上限（§5）の見直し、混雑する時間帯、起動時間の悪化、メモリ上限の妥当性。O1 の数値は S10（AWS 移行）での Fargate のサイズ決めにもそのまま使える。

### 15.3 全体の流れ

```
S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 → [公開] → S10
                                    │     │            ▲
                                    │     └─ O3（任意） │
                                    └──────── O2（任意）│
                                          O1（任意。公開後2〜4週間が目安）─┘
                                          └→ O2 の内容が充実 / S10 のサイズ決めに使える
```

---

## 16. ツール・契約・担当一覧

※ 料金はすべて目安。契約前に公式サイトで要確認。

### 16.1 契約・登録するもの

| サービス | 用途 | 費用目安 | 登録時期 | 状態 |
|---|---|---|---|---|
| GitHub | 正本（コード・設計書・Issue・PR）、CI（Actions）、イメージ置き場（GHCR） | 無料 | S1 | 必須 |
| Discord（Developer Portal） | Bot アプリの登録、専用ギルド | 無料 | S1 | 必須 |
| インフラ（Oracle / Lightsail / さくら / Vultr のいずれか） | ゲームサーバ・Bot を動かす VM | ¥0〜月 ¥2,000 程度 | S1 | **未決** |
| Cloudflare | DNS、R2（バックアップ・Terraform state）、Zero Trust（Tunnel + Access。O1 以降） | 無料（R2 は 10GB まで） | S1 | 必須 |
| Tailscale | SSH の経路 | 無料（個人プラン） | S3 | 必須 |
| 独自ドメイン | 接続先の名前（例 `simu.example.jp`）、Terraform 練習（S2）、Cloudflare Tunnel（O1） | 年 ¥1,000〜2,000 程度 | S2 | **必須**（§18-11） |
| Claude（有料プラン） | Claude Code（開発担当 AI） | 月 $20 前後 | S1 | 推奨 |
| LLM API（Claude API など） | Bot 内のログ要約・レポート | 従量。月数十〜数百円 | S7 | 任意 |
| AWS | 将来の移行先（S3 → Bedrock → Lambda / DynamoDB → Fargate） | 従量 | S10 | 将来（Lightsail を選ぶ場合は S1） |
| ChatGPT Pro 以上（Dots） | 秘書役 | 高額帯 | 任意 | 任意 |

### 16.2 ツール（無料・手元 PC / CI で使う）

| ツール | 担当 | 使う場所 |
|---|---|---|
| Git | 変更履歴 | 手元 |
| Terraform（または互換の OpenTofu） | 箱（VM・FW・DNS・R2）の作成と変更 | 手元 → CI |
| Ansible（ansible-lint / ansible-vault） | VM の中身の設定、秘密情報の暗号化 | 手元 → CI |
| Docker / docker compose | ゲームサーバ・Bot の実行 | VM |
| Python + discord.py | Bot 本体 | VM |
| rclone | R2 へのバックアップ | VM |
| GitHub Actions | lint / plan / 反映 / 通知 | GitHub |
| Uptime Kuma | 外部からの死活監視 | 任意 |
| Prometheus / Grafana | 数値の収集・グラフ化・アラート（O1） | 任意（VM 上 or Grafana Cloud） |
| Tailscale | 運営者 PC → VPS の SSH 経路 | 手元 PC・VM |
| cloudflared（Cloudflare Tunnel） | Web 画面の公開（O1 以降） | VM |
| WSL | Windows で Terraform / Ansible を動かす | 手元（Windows の場合） |

### 16.3 AI の担当

| AI | 担当 | 渡す権限 | 渡さないもの |
|---|---|---|---|
| **Claude Code** | 設計書の更新、コード作成、PR 作成、CI 失敗の修正、Issue の調査 | GitHub リポジトリ（PR 作成まで） | 本番 VM、apply 権限、秘密情報 |
| **Bot 内の LLM API** | 異常時のログ要約（Issue・Discord 通知に添付）、週次レポート | Bot が集めたデータのみ | シェル、Docker、DB 書き込み |
| Claude Code の GitHub 連携（任意） | PR の自動レビュー | 対象リポジトリの PR | 同上 |
| Dots（任意） | 週次まとめ、レビュー待ちの催促、料金・規約変更の見張り | 読み取りのみ | 書き込み・本番操作すべて |
| Bedrock（将来・AWS 版） | Bot 内 AI の置き換え | IAM で読み取り専用 | 同上 |

### 16.4 作業ごとの担当

| 作業 | 人（運営者） | Claude Code | CI（Actions） | Bot | Bot 内 AI |
|---|---|---|---|---|---|
| 要件・方針の決定 | **決定** | 提案 | | | |
| 設計書 | レビュー | **作成・更新** | | | |
| コード（Bot・Terraform・Ansible） | レビュー | **作成** | テスト・lint | | |
| 変更内容の確認 | **判断（マージ）** | | **plan / check を PR に提示** | | |
| 本番への反映 | **承認ボタン** | | **実行** | | |
| 契約・支払い・アカウントの安全設定 | **担当** | | | | |
| 秘密情報の発行と登録 | **担当** | | | | |
| 監視・異常検知 | | | ドリフト検出（毎日） | **担当** | |
| 障害の一次報告 | | | | **通知・Issue 作成** | **要約** |
| 障害の修正 | レビュー・承認 | **調査・修正 PR** | 反映 | | |
| 無人時停止・バックアップ | | | | **担当** | |
| 利用者対応・ルール運用（BAN など） | **担当** | | | コマンド提供 | |
| 費用の確認 | **担当**（予算アラート） | | | | 週次レポートに記載 |
| 復旧訓練（S9） | **実施** | 手順のコード化 | 実行 | | |

### 16.5 月額の目安

| パターン | 内訳 | 合計 |
|---|---|---|
| 最小 | Oracle Free + Cloudflare 無料 + ドメインなし（AI は無料の範囲） | **¥0** |
| 標準 | Oracle Free または小さい VM + Claude 有料プラン + LLM API 少額 | **約 ¥3,000〜5,000** |
| AWS 移行後 | 上記 + AWS 従量（遊ぶ時間に比例） | 利用量次第 |

いちばん大きな費用は **Claude の有料プラン**（開発担当 AI）。インフラ自体は ¥0〜2,000 程度に収まる。

---

## 17. セキュリティ設計（ランサムウェア・不正アクセス対策）

### 17.1 基本方針

1. **侵入される前提で設計する**（防ぐ対策だけでなく、「気づく」「被害を限定する」「作り直して戻す」まで用意する）
2. **VM が乗っ取られても、バックアップは消せない・書き換えられない**ようにする
3. **復旧は「直す」のではなく「作り直す」**（Terraform + Ansible でゼロから作り、侵入前のバックアップから戻す）
4. 権限は**用途ごとに分けて最小限**にする（1つ漏れても全部は取られない）

### 17.2 想定する脅威と対策

| # | 脅威 | 起きること | 対策 | 優先度 |
|---|---|---|---|---|
| T1 | **ランサムウェア / VM の乗っ取り** | セーブ・DB が暗号化される。VM 上の認証情報でバックアップまで消される | **削除・上書きできないバックアップ**（R2 のバケットロック / S3 Object Lock、保持 30日）、バージョニング、**別アカウント（または手元）に2つ目の複製**、復旧訓練（S9） | 必須 |
| T2 | **運営者の PC の感染** | SSH 鍵・vault パスワード・クラウドの認証情報が盗まれる | SSH 鍵はパスフレーズ付き（可能なら FIDO2 キー）、秘密はパスワードマネージャのみ、クラウドの長期アクセスキーを PC に置かない、ブラウザのログインは MFA | 必須 |
| T3 | **SSH への総当たり・脆弱性攻撃** | VM に侵入される | **SSH ポートをインターネットに公開しない**（Tailscale 経由のみ）、鍵認証のみ、root ログイン禁止、fail2ban | 必須 |
| T4 | **GitHub アカウントの乗っ取り** | 悪意ある変更が CI 経由で本番に反映される | パスキー / セキュリティキーで MFA、main ブランチ保護（PR 必須・force push 禁止・CI 合格必須）、**反映は Environments の承認必須**、監査ログの確認 | 必須 |
| T5 | **サプライチェーン攻撃**（依存ライブラリ・Actions・イメージ・pak の改ざん） | 悪意あるコードが紛れ込む | Actions は**コミット SHA で固定**、Python 依存はロックファイル + ハッシュ固定、Dependabot、イメージのダイジェスト固定と Trivy 等での脆弱性スキャン、pak は sha256 固定（§8） | 必須 |
| T6 | **秘密情報の漏洩**（コミット・ログへの混入） | Bot の乗っ取り、クラウドの不正利用 | GitHub の secret scanning + **push protection** を有効化、ansible-vault、ログにトークンを出さない、漏洩時の**差し替え手順を事前に用意** | 必須 |
| T7 | **Bot 経由の乗っ取り**（Bot の脆弱性） | Bot は Docker を操作できる＝**実質 root** | Bot に Docker ソケットを直接渡さず、**docker-socket-proxy で必要な操作だけ許可**、Bot の入力（名前・URL・ファイル）は厳格に検証 | 推奨 |
| T8 | **ゲームサーバへの攻撃**（古い C++ 通信処理の脆弱性、細工したセーブのアップロード） | コンテナ内での任意コード実行 | コンテナ分離（非 root・読み取り専用・権限削除・外向き通信遮断）、アップロードはサイズ上限と形式チェック、管理パスワードは長いランダム値 | 必須 |
| T9 | **サービス妨害**（接続の大量送信、コマンド連打） | 他の利用者が遊べない | ufw の接続数制限、Bot コマンドのレート制限・利用上限、ギルド限定・アカウント作成からの日数制限 | 推奨 |
| T10 | **AI へのプロンプトインジェクション** | プレイヤー名やチャットに仕込んだ文が AI の要約・Issue・PR を操る | AI の入出力は**信頼しないデータとして扱う**、Issue には「自動生成・未検証」ラベル、AI にツール実行権限を渡さない、PR は必ず人がレビュー | 推奨 |
| T11 | **乗っ取り後の不正利用**（暗号資産の採掘など） | 想定外の請求、踏み台にされる | 予算アラート、CPU・外向き通信の急増を通知、ゲームコンテナの外向き通信遮断 | 推奨 |

### 17.3 バックアップ設計（3-2-1 ＋ 消せない）

| 世代 | 置き場所 | 書き込む人 | 消せる人 |
|---|---|---|---|
| ① 日次（30日保持） | R2 バケット A（**バケットロックで保持期間中は削除不可**、バージョニング有効） | VM（このバケット専用トークン） | 誰も消せない（保持期間後に自動削除） |
| ② 週次（3か月保持） | **別アカウント**のストレージ（R2 / S3 Object Lock）、または手元の外付けディスク | GitHub Actions（①から読み取って複製） | 誰も消せない |
| ③ Terraform state・設定 | Git（コード）＋ state はバージョニング付きバケット | CI | — |

- 「VM のトークンでは①を**消せない**」「②は VM から**見えない**」状態にすることで、VM が乗っ取られても戻れる。
- R2 のバケットロック・S3 Object Lock の仕様と料金は要確認。
- 復元できることを**月1回、自動で確認**する（最新バックアップを staging に展開してゲームサーバが起動するか）。

### 17.4 アクセス経路

```
運営者 PC ──(Tailscale)──────────────▶ SSH :22              ← インターネットには非公開
運営者・共同管理者のブラウザ
   ──▶ Cloudflare Access（ログイン確認）──▶ Tunnel ──▶ Grafana 等  ← VPS のポートは開けない（O1 以降）
GitHub Actions ──▶ GHCR にイメージを置く                       ← VM へは接続しない
VM ──(定期的に取りに行く)──▶ GHCR / GitHub                      ← 反映は VM からの取得方式
プレイヤー ──▶ ゲームポート 13400〜13499 のみ公開
Bot ──(外向きのみ)──▶ Discord
```

- 外から VM に入れる経路は**ゲームポートだけ**にする。

| 入口 | 使う道具 | 理由 | 守るためにやること |
|---|---|---|---|
| SSH（運営者のみ） | **Tailscale** | 設定が少ない。機器同士の直接通信で速い | Tailscale のログインに使うアカウント（Google / GitHub 等）にパスキー / MFA。接続ルール（ACL）で「運営者の機器 → VPS の 22番」だけ許可。使わなくなった機器はすぐ削除 |
| Web 画面（Grafana、将来の管理画面） | **Cloudflare Tunnel + Access** | ブラウザだけで開ける。共同管理者の追加が許可ルールの編集だけで済む | Access の許可ルールは個別のメールアドレス / GitHub アカウント指定（「誰でも」は禁止）。セッションの有効期限を短めに |
| 緊急用（Tailscale が使えない時） | クラウドの管理画面のコンソール接続 | 非常口 | 手順を docs/ に記載。クラウドのアカウントは MFA 必須 |

- Tailscale・Cloudflare Zero Trust はどちらも無料枠で足りる見込み（範囲は要確認）。
- どちらも Terraform で管理する（Tailscale の ACL、Cloudflare の Tunnel・Access アプリ・許可ルール）。
- **ゲームの通信はどちらも通さない**（プレイヤーにソフトを入れてもらえないため）。

### 17.5 検知（気づく仕組み）

| 何を | どう | 通知先 |
|---|---|---|
| SSH ログイン・sudo の実行 | auditd / journald を監視 | Discord 運営チャンネル（即時） |
| 想定外のコンテナ・プロセス | Bot が Docker イベントを監視（Bot 管理外のコンテナを検知） | 同上 |
| CPU・外向き通信の急増 | Bot の定期チェック（O1 導入後は Alertmanager） | 同上 |
| 手作業による設定変更 | 毎日の `terraform plan`、Ansible `--check` | 同上 |
| GitHub の不審な操作 | GitHub の監査ログ・セキュリティ通知 | メール |
| 請求額 | 予算アラート | メール |

ログは**VM の外にも送る**（乗っ取られると VM 内のログは消されるため）。O1 で Grafana Cloud を使う場合はそこへ、使わない場合は R2 へ日次で退避する。

### 17.6 侵害時の対応手順（ランブック）

```
1. 隔離     クラウドの FW でゲームポート以外も含め全遮断（Terraform の変数1つで切り替えられるようにしておく）
2. 連絡     Discord で利用者に告知（一時停止・データは保護済みであること）
3. 鍵の交換 Bot トークン、API トークン、SSH 鍵、vault パスワード、管理パスワードをすべて差し替え
4. 作り直し 汚染された VM は直さずに destroy → Terraform + Ansible で新規作成
5. 復元     侵入より前の日付のバックアップ（消せない世代）から戻す
6. 原因調査 ログ（VM 外に退避した分）と GitHub の監査ログで侵入経路を特定 → 再発防止を PR で反映
7. 記録     docs/ に障害記録を残す
```

S9 の復旧訓練で、この手順を一度通して実施しておく。

### 17.7 利用者向けの取り決め

- **利用規約**（禁止行為、BAN 基準、データ保証なし）と**プライバシーポリシー**（保存する情報: Discord ID・表示名・操作履歴・セーブ）を公開前に用意する。
- 保存する個人情報は最小限にする（メールアドレスや IP アドレスは保存しない）。

### 17.8 ロードマップへの割り当て

| 段階 | 追加するセキュリティ作業 |
|---|---|
| S1 | パスワードマネージャ導入、全アカウントにパスキー / MFA、GitHub の secret scanning・push protection・main 保護、予算アラート |
| S2 | API トークンを用途別に分けて作成、state バケットのバージョニング |
| S3 | クラウド FW はゲームポートのみ許可、SSH は Tailscale 経由（cloud-init で導入、ACL は Terraform）、緊急遮断用の変数、緊急用コンソール接続の手順書 |
| S4 | `base` ロール: 鍵認証のみ、root ログイン禁止、fail2ban、自動更新、auditd、ログイン通知 |
| S5 | コンテナの権限制限、イメージのダイジェスト固定、pak の sha256 固定と R2 保管 |
| S6 | 入力検証、レート制限、docker-socket-proxy |
| S7 | **削除できないバックアップ**（①）、ログの VM 外への退避、異常検知の通知 |
| S8 | Actions の SHA 固定、Dependabot、イメージスキャン、反映の承認必須化、別アカウントへの週次複製（②） |
| S9 | 復旧訓練に**侵害時の手順（§17.6）**を含める。月1回の自動復元テスト |
| 公開前 | 利用規約・プライバシーポリシー |
| S10 | AWS: root の MFA、IAM Identity Center、CloudTrail、S3 Object Lock、GitHub からは OIDC で接続（長期キーを作らない） |

---

## 18. 残っている決定事項

依存関係: **1 → 2**（予算でインフラが決まる）、**11 → S2**（ドメインが無いと S2 の練習ができない）、**9 → S1**（導入手順が変わる）。
1・2・9・11 が決まれば S1 に着手できる。3〜8・10 は S5〜S7 までに決めればよい。

| # | 項目 | 推奨 | 決める期限 |
|---|---|---|---|
| 1 | 予算 | 月 ¥3,000 以内（うち Claude 有料プランが大半） | S1 前 |
| 2 | インフラ | 予算 ¥0 なら Oracle Free、少額なら Lightsail か Vultr | S1 前 |
| 3 | 操作 UI | Discord Bot | S6 前 |
| 4 | 言語 | Python | S6 前 |
| 5 | リポジトリ | 新規・公開リポジトリ（秘密情報は置かない） | S1 |
| 6 | 利用範囲 | 専用ギルド限定 | S6 前 |
| 7 | 制限値 | 下記の初期案 | S7 前 |
| 8 | 初期 pak | 3種類から始める | S5 前 |
| 9 | 手元 PC | （利用者の環境を確認） | S1 前 |
| 10 | 2つ目のバックアップ先 | Object Lock 対応の別クラウド | S8 前 |
| 11 | 独自ドメイン | 取得する（Cloudflare で管理） | S2 前 |

### 18-1. 予算
- **決めること**: 月にいくらまで出せるか。
- **補足**: インフラは ¥0〜2,000 で収まる。最大の費用は Claude の有料プラン（月 $20 前後）。
- **関連して決めること**: 「ワールドは遊ぶ時だけ起動する」か「24時間いつでも入れる」か。後者で AWS サーバレスにすると費用が跳ね上がる（§14）。VPS 版ならどちらでも費用は同じ。

| 予算 | できること |
|---|---|
| ¥0 | Oracle Free + 無料サービスのみ。開発は Claude の無料範囲（制限が厳しい） |
| 〜¥1,000 | 上記 + ドメイン（年額を月割り）+ LLM API 少額 |
| 〜¥3,000 | Claude 有料プラン + 小さな有料 VM、または Oracle Free + 余裕 |
| 〜¥5,000 | Claude 有料プラン + 4GB 級の VM + LLM API |

### 18-2. インフラ
- **決めること**: VM をどこで借りるか（条件: Terraform で VM ごと作れる、日本リージョン）。

| 候補 | 費用 | 良い点 | 注意点 |
|---|---|---|---|
| Oracle Always Free | ¥0 | 24GB の余裕。O1 も VM 上で動かせる | カード登録、ARM 版ビルド、在庫切れ、アイドル回収（従量課金アカウントへの切り替えで回避。要確認） |
| AWS Lightsail | 2GB で $10〜12 程度 | S10（AWS 移行）と同じアカウント・Terraform で地続き | **CPU がバースト型**（使い続けると制限される）。同時稼働を少なめに |
| Vultr（東京） | 2GB で $10〜12 程度 | CPU 制限なし、Terraform 対応が良好 | ドル建て |
| さくらのクラウド | 数千円 | 国内事業者・円建て・安定 | やや高め |

- **推奨**: 予算 ¥0 → Oracle Free。少額で AWS 学習を重視 → Lightsail。少額で安定重視 → Vultr。
- **乗り換え**: どれを選んでも「Docker が動く Linux 1台」が前提なので、Terraform のモジュール差し替えで移行できる。

### 18-3. 操作 UI（Discord Bot で確定してよいか）
- **決めること**: 利用者の操作を Discord Bot にするか、Web サイトにするか。
- **Bot にした場合**: ログイン機能・画面・公開用 Web サーバが不要。セーブ添付は 10MB まで（超える分は P3 で期限付きアップロード URL）。
- **Web にした場合**: 構築量が大きく増える（ログイン、画面、HTTPS 公開）。
- **推奨**: Discord Bot。認証も Discord アカウントで決まる。

### 18-4. 言語
- **決めること**: Bot を何の言語で書くか。

| 言語 | 良い点 | 注意点 |
|---|---|---|
| **Python** | 読みやすい、Discord Bot の情報が最多、Ansible と同じ言語 | 実行速度は遅め（今回は問題なし） |
| TypeScript | Discord Bot の情報が多い、将来 Web 画面を作るなら共通化できる | 型・ビルドの仕組みを覚える必要 |
| Go | 単一ファイルで配布、高速 | Discord Bot の情報が少なめ |

- **推奨**: Python。コードは Claude Code が書き、人は読んでレビューする前提でも、読みやすさが効く。

### 18-5. リポジトリ
- **決めること**: ①新規作成するか、②名前、③公開か非公開か、④個人アカウントか Organization か。
- **名前案**: `simutrans-hosting` / `otrp-hosting` / `simu-hosting`
- **公開 / 非公開**:

| | 公開 | 非公開 |
|---|---|---|
| GitHub Actions | 無料で使い放題 | 月の無料枠あり（超過は有料） |
| secret scanning / push protection | 無料で使える | 有料機能の場合あり（要確認） |
| 構成が見られる | 見られる（秘密情報は置かない設計なので致命的ではない） | 見られない |

- **推奨**: 新規・**公開**・個人アカウント（共同管理者が増えたら Organization へ移行）。公開する場合も、IP アドレス・ドメイン以外の内部情報（ポート範囲以外の詳細など）は変数で外出しする。

### 18-6. 利用範囲
- **決めること**: 誰が Bot を使えるか。

| 方式 | 良い点 | 注意点 |
|---|---|---|
| **専用ギルド限定** | 利用者の把握・BAN・告知が簡単。荒らし対策がしやすい | 利用者はそのギルドに参加する必要 |
| どのギルドにも招待可 | 広がりやすい | 管理が難しい。容量があっという間に埋まる |

- **推奨**: 専用ギルド限定。参加条件の例: Discord アカウント作成から30日以上、ギルド参加から7日以上で作成可能。

### 18-7. 制限値（初期案）

| 項目 | 初期案 | 備考 |
|---|---|---|
| 1人あたりの所有サーバ数 | 2 | |
| 全体の同時稼働数 | VM に合わせる（2GB: 2 / 4GB: 4 / 24GB: 8） | O1 の数値を見て見直す |
| マップ上限 | 512×512 | メモリ上限 1.5GB |
| 無人で休止するまで | 30分 | |
| 保持するセーブ数 | 自動 5 + 手動 5 | |
| アップロードできるセーブのサイズ | 10MB（Discord 添付の上限） | P3 で拡張 |
| 未使用サーバの自動削除 | 90日起動なし → 警告 DM → 14日後に削除 | |
| コマンドのレート制限 | 1人あたり 1分に 5回まで | |
| 作成できる人 | アカウント作成 30日以上 + ギルド参加 7日以上 | §18-6 |

### 18-8. 初期搭載する pak
- **決めること**: 最初に用意する pakset の種類。
- **考え方**: 多いほどディスクとテンプレートセーブ（空マップ）の準備が増える。最初は少なく始めて、要望で追加する。
- **候補**（`get_pak.sh` に載っているもの）: pak64 / pak64.japan / pak128 / pak128.japan / pak128.britain / pak64.german など。
- **推奨**: 日本中心なので **pak64・pak64.japan・pak128.japan の3種類**から開始（コミュニティでよく使われているものがあれば差し替え）。
- **確認事項**: OTRP で各 pak が問題なく動くか（S5 で確認）、サーバ側での保管・利用がライセンス上問題ないか（クライアントへの配布は公式の入手先を案内する）。

### 18-9. 手元 PC の OS
- **決めること**: Terraform / Ansible を動かす作業用 PC の OS。

| OS | 導入方法 | 注意点 |
|---|---|---|
| Windows | **WSL2（Ubuntu）**を入れ、その中で Terraform / Ansible を使う | Ansible は Windows では直接動かない。SSH 鍵は WSL 側に置く |
| Mac | Homebrew で導入 | — |
| Linux | パッケージで導入 | — |

- 同じ PC に Simutrans OTRP クライアントを入れておくと、S5 の接続確認ができる。

### 18-10. 2つ目のバックアップ先
- **決めること**: VM から見えない「2つ目の複製」をどこに置くか（§17.3 の ②）。

| 候補 | 費用 | 良い点 | 注意点 |
|---|---|---|---|
| **別クラウドのストレージ**（Backblaze B2 / AWS S3 など、Object Lock 対応） | 数 GB なら無料〜数十円 | 自動化でき、削除不可にできる | 別アカウントの管理が増える |
| 手元の外付けディスク | ディスク代のみ | ネットから完全に切り離せる（最強のランサムウェア対策） | 手作業。接続中に PC が感染すると巻き込まれる |

- **推奨**: 別クラウド（Object Lock 付き）に GitHub Actions で週次複製。余裕があれば月1回、外付けディスクにも手で複製。
- 無料枠・Object Lock の仕様は要確認。

### 18-11. 独自ドメイン（v0.8 で追加）
- **決めること**: ドメインを取るか、何にするか。
- **必要な理由**: S2 の Terraform 練習（Cloudflare の DNS レコード）、接続先の名前（`simu.example.jp:13401`）、O1 の Cloudflare Tunnel + Access は**どれもドメインが前提**。
- **費用**: 年 ¥1,000〜2,000 程度（`.com` / `.net` 等。`.jp` はやや高め）。Cloudflare Registrar なら原価に近い価格で、DNS 管理も一か所にまとまる。
- **推奨**: S2 の前に取得し、Cloudflare で管理する。
