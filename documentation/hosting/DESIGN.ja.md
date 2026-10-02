# Simutrans OTRP サーバ間借りサービス 設計書（ドラフト v0.2）

> 目的: 「自分ではサーバを立てられない人」が、Discord から数コマンドで
> Simutrans OTRP のマルチプレイサーバを立て、仲間と遊べるようにする。

## 0. 決定事項・方針（v0.2）

| 項目 | 決定 / 方針 | 状態 |
|---|---|---|
| 予算 | 当面 **¥0** | 決定 |
| 対象 | 日本国内のみ（海外対応しない） | 決定 |
| スペック | 最低限動けばよい（小〜中マップ、同時稼働は数台） | 決定 |
| 操作 UI | **Discord Bot を主にする**。Web は作らない（必要になったら後から追加） | 提案 |
| インフラ | **Oracle Cloud Always Free（東京/大阪）1台**。ダメなら国内 VPS（月 ¥1,000 前後）へ移行 | 提案 |
| 構成 | **1台に全部入り**（Bot・DB・ゲームサーバ） | 提案 |
| DB | **SQLite**（1台構成なら DB サーバ不要） | 提案 |
| pakset | 標準インストーラ（`get_pak.sh`）で取れるものを初期搭載。それ以外は運営が追加 | 決定 |
| OTRP バージョン | **基本は最新版のみ**。切り替えの移行期間だけ 1つ前も残す | 決定 |
| 言語 | **Python**（discord.py） | 提案 |
| リポジトリ | サービス用に**新しいリポジトリを作る** | 提案 |
| 認証 | Discord アカウントをそのまま使う（Bot 方式なら別途ログイン機能は不要） | 提案 |

---

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
 │ VM 1台（Oracle Free ARM / 国内 VPS）      │                 │
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
   オブジェクトストレージ（Oracle Object Storage 無料 20GB / Cloudflare R2 無料 10GB）
```

- 1台構成なので、**ノード管理・スケジューラ・ジョブキュー・agent は作らない**（Bot が直接 Docker を操作する）。
- 将来複数台にする場合は、Bot から Docker 操作部分を「agent」として切り出す。最初から関数単位で分けておく。

---

## 4. インフラ選定（予算 ¥0 前提）

### 無料で使える候補

| 候補 | スペック | 日本 | 評価 |
|---|---|---|---|
| **Oracle Cloud Always Free** | ARM 最大 4コア / 24GB、ディスク 200GB、Object Storage 20GB、転送 10TB/月 | ◎ 東京・大阪 | **ほぼ唯一の現実解**。下記の手間あり |
| AWS / Azure 無料枠 | 1GB 程度、期間限定（クレジット制など） | ○ | 期限が切れると有料、1GB では厳しい |
| Google Cloud 無料枠 | e2-micro 1GB | ✕（米国リージョンのみ） | 遅延が大きく不可 |
| 自宅サーバ | 手元の PC / ラズパイ | ◎ | 電気代のみ。ポート開放と固定 IP/DDNS が必要で、自宅 IP が公開される |

### Oracle の「面倒くささ」と対策

| 面倒な点 | 対策 |
|---|---|
| 登録時にクレジットカード認証が必要 | 課金されないことを確認済みの上で登録（無料枠の範囲内なら請求なし） |
| ARM インスタンスが「Out of capacity」で作れないことがある | 時間を置いて再試行 / 大阪リージョンも試す / 最初は 2コア 12GB など小さめで作る |
| **アイドル状態が続くとインスタンスを回収される**（Always Free の仕様。CPU 等の使用率が7日間低いと対象） | 「従量課金（PAYG）アカウント」へアップグレードすると回収対象外（無料枠内なら ¥0 のまま）。**要: 最新規約の確認** |
| ARM（arm64）なのでバイナリを ARM 用にビルドする必要がある | Simutrans は ARM でも普通にビルドできる。Docker イメージを amd64/arm64 両対応で作る |
| 管理画面（VCN、セキュリティリスト）がわかりにくい | 開けるのは SSH とゲーム用ポート範囲のみなので、設定手順を一度手順書化すれば済む |

### 推奨

1. **まず Oracle Always Free（東京）**で 4コア / 24GB の ARM VM を1台作る。インフラエンジニアなら手順自体は難しくない。
2. 取れなかった・運用が嫌になった場合の**逃げ先は国内 VPS の最小プラン**（2GB で月 ¥1,000 前後。小マップ 2〜3 サーバ程度）。
3. どちらでも動くよう、前提は「**Docker が動く Linux 1台**」だけにする（クラウド固有サービスに依存しない）。
4. バックアップ先は、Oracle を使うなら同じ Oracle の Object Storage（無料 20GB）。VPS へ移った場合は Cloudflare R2（無料 10GB）。どちらも S3 互換 API で扱えるので、コードは共通にする。

### 収容数の目安（24GB / 4コア）

- 1サーバ 1〜2GB 上限 → **同時稼働 8〜10 サーバ程度**（CPU が先に限界になる想定）。
- 休止機能により、**登録サーバ数はその数倍**を受け入れられる。

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
| バックアップ | `boto3`（S3 互換） | Oracle/R2 どちらでも同じコードで使える |
| 実行環境 | Bot 自体も Docker コンテナ、`docker compose` で起動 | 構築手順が `compose up` だけになる |
| サーバ構築 | シェルスクリプト or Ansible | 慣れている方でよい |
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
  - `deploy/` … `compose.yaml`、サーバ構築スクリプト、手順書
  - `docs/` … この設計書（新リポジトリ作成時に移す）
- 新しい OTRP タグを検知する仕組み: 新リポジトリの GitHub Actions で定期的にタグを確認する（または手動実行）。

---

## 12. ロードマップ

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| **P0: 手動で動かす** | Oracle VM 作成、サーバ用イメージ作成、pak 取得、`docker run` で 1サーバを起動 | クライアントから接続して遊べる |
| **P1: Bot 最小版** | create / start / stop / info / delete、SQLite、権限 | 他の人が Discord だけで自分のサーバを立てられる |
| **P2: 運用機能** | 無人時の自動停止、セーブ一覧・ロールバック、日次バックアップ、kick/ban/say、上限チェック | 放置しても資源を食わず、データが消えない |
| **P3: 改善** | 大きいセーブのアップロード URL、バージョン自動移行、運営コマンド、公開リスト掲載 | 運営の手作業がほぼ無い |
| 将来 | 複数台・PostgreSQL・Web 画面 | 必要になったら |

---

## 13. 残っている決定事項

1. **Discord Bot 方式で確定してよいか**（認証もこれで決まる）
2. **Oracle Always Free で始めてよいか**（クレジットカード登録が許容できるか。ダメなら月 ¥1,000 前後の VPS）
3. **言語は Python でよいか**
4. **新しいリポジトリを作ってよいか**、名前は何にするか
5. 利用範囲: 専用 Discord ギルド内に限定するか、誰でも Bot を招待できるようにするか
6. 制限値（§5）の初期案はこれでよいか
7. 初期搭載する pak の絞り込み（容量節約のため全部は入れない、など）
