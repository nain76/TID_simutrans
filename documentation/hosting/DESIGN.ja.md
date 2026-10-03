# Simutrans OTRP サーバ間借りサービス 設計書（ドラフト v0.3）

> 目的: 「自分ではサーバを立てられない人」が、Discord から数コマンドで
> Simutrans OTRP のマルチプレイサーバを立て、仲間と遊べるようにする。
>
> 副目的: 運営者（オンプレ保守経験のみ）が、**クラウド構築・IaC（Terraform / Ansible）・AI を使った運用**を
> 実践を通して身につける。

## 0. 決定事項・方針（v0.3）

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
- 制限: 非 root 実行、`--read-only`、`--cap-drop=ALL`、`--memory`、`--cpus=1`、`--pids-limit`。
- 外向き通信は原則遮断する（公開リスト掲載時のみ許可）。
- **アップロードされたセーブは C++ の読み込み処理にそのまま渡る**ため、悪意あるファイルを想定し、コンテナ分離を必須とする。

### 新規マップについて
`sim` にはサーバ起動時に新規マップを自動生成するオプションが乏しい。そのため、**運営があらかじめ作っておいた空マップのテンプレートセーブ**（pak × サイズごと）から選ぶ方式にする。

---

## 8. pakset 管理

- **初期搭載**: このリポジトリの `get_pak.sh` は引数で番号を指定すれば対話なしで実行できるので、サーバ構築時にそれで取得する。対象は pak64 / pak128 / pak128.japan / pak64.japan 等、標準インストーラに載っているもの。
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
│       ├── base/                # SSH 鍵認証のみ、ufw、unattended-upgrades、fail2ban、時刻同期
│       ├── docker/              # Docker Engine と compose
│       ├── simu_host/           # /srv/simu 配下、get_pak.sh で pak 取得、テンプレートセーブ
│       ├── bot/                 # compose.yaml と .env を配置して起動
│       └── backup/              # rclone で R2 へ日次バックアップ
└── .github/workflows/           # §13
```

### state と秘密情報

| 対象 | 置き場所 | 注意 |
|---|---|---|
| Terraform state | R2（S3 互換 backend）または S3 | **ローカルに置かない**（PC が壊れると管理不能になる）。中に IP などが入るので公開しない |
| クラウドの API トークン | 手元: 環境変数 / CI: GitHub Secrets（Environments） | 権限を最小にしたトークンを作る |
| Bot トークン、LLM API キー | ansible-vault で暗号化して Git 管理 → VM の `.env` に展開 | 平文でコミットしない |
| SSH 秘密鍵 | 手元のみ（CI で使う場合は専用の鍵を別途作る） | — |

### 守るルール
1. **本番 VM に SSH して設定を手で変えない**（調査のためのログイン・閲覧は可）。変えたい時はコードを直す。
2. Ansible は **2回目の実行で `changed=0` になること**を確認する（同じ手順を流しても結果が同じ = 冪等）。
3. `terraform plan` に**想定外の「destroy（削除）」が出たら止まる**。
4. 練習は `envs/staging` で行い、終わったら `terraform destroy` で消す（費用も節約）。

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

| 段階 | 内容 | 身につくこと | 完了条件 |
|---|---|---|---|
| **S1 準備** | GitHub 新リポジトリ、クラウド・Cloudflare アカウント、MFA、予算アラート。手元に Terraform / Ansible を導入（Windows なら WSL） | アカウント管理の基本 | 各サービスに安全にログインできる |
| **S2 Terraform 入門** | Cloudflare の DNS レコード1件だけを Terraform で作る → plan → apply → destroy。state を R2 に置く | **Terraform の基本サイクル**、state | 作って消すのを3回繰り返せる |
| **S3 箱を作る** | `modules/vps` で VM と FW を作成、cloud-init で Ansible 用ユーザー登録、inventory 自動生成 | Terraform のモジュール、output | `terraform apply` 1回で SSH できる VM ができる |
| **S4 中身を作る** | Ansible `base` / `docker` ロール | **Ansible の基本**、冪等性 | 2回目の実行で `changed=0` |
| **S5 手動で遊ぶ** | Docker で Simutrans サーバを**手で**起動し、手元クライアントから接続 → 手順を `simu_host` ロールに落とし込む | Docker、「手作業 → コード化」の流れ | Ansible だけでゲームサーバが立つ |
| **S6 Bot 最小版** | create / start / stop / info / delete（コードは Claude Code が作成、人がレビュー） | PR レビュー、Python を読む力 | 他の人が Discord だけでサーバを立てられる |
| **S7 運用機能** | 無人時の自動停止、セーブ一覧・ロールバック、R2 バックアップ（`backup` ロール）、kick/ban/say、上限チェック、異常通知 | 運用設計 | 放置しても資源を食わず、データが消えない |
| **S8 CI 化** | PR で plan / lint、マージ後の反映（承認付き）、毎日のドリフト検出、Discord 通知 | **GitOps**、GitHub Actions | 手元から apply しなくなる |
| **S9 復旧訓練** | staging 環境を Terraform + Ansible で**ゼロから作り、バックアップから復元**→ 所要時間を記録 → destroy | 障害復旧（DR）、IaC の真価 | 手順書なしで○分以内に復旧できる |
| ── **一般公開・運用開始** ── | | | |
| **S10 AWS 移行** | ① AWS の安全設定 → ② バックアップ先を S3 へ → ③ AI レポートを Bedrock へ → ④ 管理部分を Lambda + DynamoDB へ → ⑤ ゲームを Fargate へ（すべて Terraform） | AWS、IAM、サーバレス | VPS を解約しても動く |

各段階は「元に戻せる状態」を保ったまま進める。S9 の復旧訓練は、本番公開前に必ず一度行う。

---

## 16. 残っている決定事項

1. **予算**: ¥0 / 〜¥1,000 / 〜¥3,000 のどれか → §4 のインフラが決まる
2. **インフラ**: Oracle Free / AWS Lightsail / さくらのクラウド・Vultr のどれか
3. **Discord Bot 方式で確定してよいか**（認証もこれで決まる）
4. **言語は Python でよいか**
5. **新しいリポジトリを作ってよいか**、名前は何にするか
6. 利用範囲: 専用 Discord ギルド内に限定するか、誰でも Bot を招待できるようにするか
7. 制限値（§5）の初期案はこれでよいか
8. 初期搭載する pak の絞り込み（容量節約のため全部は入れない、など）
9. 手元の作業環境（Windows / Mac / Linux）→ S1 の導入手順が変わる
