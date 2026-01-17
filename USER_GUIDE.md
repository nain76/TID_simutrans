# 列車位置追跡システム - 使い方説明書

本書では、列車位置追跡システムのインストール方法、使い方、トラブルシューティングについて詳しく説明します。

## 目次

1. [システム概要](#システム概要)
2. [必要な環境](#必要な環境)
3. [インストール手順](#インストール手順)
4. [基本的な使い方](#基本的な使い方)
5. [トラブルシューティング](#トラブルシューティング)
6. [よくある質問 (FAQ)](#よくある質問-faq)

---

## システム概要

### 機能紹介

列車位置追跡システムは、Simutrans OTRPで走行中の列車の位置情報をWeb上で確認できるツールです。

**主な機能:**
- リアルタイムな列車位置の表示（約30秒ごとに更新）
- 路線・線路種別・検索によるフィルタリング
- Basic認証による安全なアクセス制御
- 外部からのアクセス対応（グローバルIP対応）

### システム構成

```
┌─────────────────┐
│  Simutrans OTRP │  ← ゲーム本体
└────────┬────────┘
         │ Squirrelスクリプト (30秒ごと)
         ↓
┌─────────────────────┐
│ train_positions.json │  ← 共有JSONファイル
└────────┬────────────┘
         │ ファイル読み込み
         ↓
┌──────────────────────┐
│ Python Flask サーバー │  ← Webサーバー
└────────┬─────────────┘
         │ HTTP/JSON API
         ↓
┌──────────────────┐
│  Webブラウザ     │  ← 閲覧用UI
└──────────────────┘
```

---

## 必要な環境

### 必須ソフトウェア

| ソフトウェア | 必要バージョン | 用途 |
|------------|---------------|------|
| Simutrans OTRP | 最新版 | ゲーム本体 |
| Python | 3.8以降 | Webサーバー |
| Webブラウザ | 最新版 | 表示用 |

### 対応OS

- ✅ Windows 10/11
- ✅ Windows Server 2016以降
- ✅ Ubuntu 20.04以降
- ✅ Debian 10以降
- ✅ その他Linux (Python 3.8+が動作すれば可)

---

## インストール手順

### ステップ1: AIスクリプトの配置

#### Linux の場合

```bash
# Simutransディレクトリに移動
cd /path/to/simutrans

# スクリプトをコピー
mkdir -p ai/train_tracker
cp -r /path/to/repository/simutrans/ai/train_tracker/* ai/train_tracker/
```

#### Windows の場合

```cmd
:: Simutransディレクトリに移動
cd C:\path\to\simutrans

:: ディレクトリを作成
mkdir ai\train_tracker

:: スクリプトをコピー
xcopy /E /I C:\path\to\repository\simutrans\ai\train_tracker ai\train_tracker
```

**確認**: `ai/train_tracker/ai.nut` が存在することを確認

### ステップ2: Webサーバーのセットアップ

#### 2-1. Python のインストール確認

**Linux:**
```bash
python3 --version
# Python 3.8.0 以降であればOK
```

**Windows:**
```cmd
python --version
REM Python 3.8.0 以降であればOK
```

Python がインストールされていない場合:
- Windows: https://www.python.org/downloads/ からダウンロード
- Linux: `sudo apt install python3 python3-pip` (Ubuntu/Debian)

#### 2-2. 依存パッケージのインストール

```bash
# Webサーバーディレクトリに移動
cd /path/to/repository/train_tracker_server

# 依存パッケージをインストール
pip install -r requirements.txt
```

#### 2-3. 環境変数の設定

**.env ファイルを作成:**

**Linux:**
```bash
cp .env.example .env
nano .env  # または vi, vim など
```

**Windows:**
```cmd
copy .env.example .env
notepad .env
```

**.env の編集内容:**

```ini
# 認証情報（重要！必ず変更してください）
AUTH_USERNAME=your_username
AUTH_PASSWORD=your_secure_password

# JSONファイルのパス
# Linux の例:
JSON_PATH=/home/username/simutrans/train_positions.json

# Windows の例:
# JSON_PATH=C:\Users\username\Documents\simutrans\train_positions.json

# ポート番号（デフォルト: 5000）
PORT=5000

# デバッグモード（本番環境では false）
DEBUG=false
```

**重要**: `AUTH_PASSWORD` は必ず強力なパスワードに変更してください！

### ステップ3: SimutransでAIスクリプトを読み込み

1. **Simutransを起動**し、既存のゲームをロードまたは新規ゲームを開始
2. **新しいAIプレイヤーを追加:**
   - メニューから **「プレイヤー」→「新しいプレイヤー」** を選択
   - または画面下部の**プレイヤー管理ボタン**をクリック
3. **空きスロットを選択**し、**「AIプレイヤーを追加」** をクリック
4. **AIスクリプト選択画面**で `train_tracker` を選択
5. **「選択」** をクリック

AIプレイヤーが追加されると、コンソール（`~` キーで表示）に以下のように表示されます:

```
[Train Tracker AI] Started for player: AI Player
[Train Tracker AI] Export interval: ~30 seconds
[Train Tracker AI] Output file: train_positions.json
```

### ステップ4: Webサーバーの起動

#### Linux の場合

```bash
cd /path/to/repository/train_tracker_server
python3 server.py
```

#### Windows の場合

```cmd
cd C:\path\to\repository\train_tracker_server
python server.py
```

サーバーが起動すると、以下のように表示されます:

```
[Train Tracker Server] Starting...
[Train Tracker Server] JSON Path: /path/to/train_positions.json
[Train Tracker Server] Port: 5000
 * Running on all addresses (0.0.0.0)
 * Running on http://127.0.0.1:5000
 * Running on http://192.168.1.100:5000
```

### ステップ5: ブラウザでアクセス

#### ローカルアクセス

ブラウザで以下のURLを開きます:

```
http://localhost:5000
```

#### 外部からのアクセス

同じネットワーク内の他の端末から:

```
http://192.168.1.100:5000
（サーバーのローカルIPアドレス）
```

インターネット経由:

```
http://YOUR_GLOBAL_IP:5000
（グローバルIPアドレス）
```

**初回アクセス時**: ブラウザがユーザー名とパスワードを要求します。`.env` で設定した認証情報を入力してください。

### ステップ6: ファイアウォールの設定（外部アクセス時）

#### Linux (ufw)

```bash
sudo ufw allow 5000/tcp
sudo ufw reload
```

#### Linux (firewalld)

```bash
sudo firewall-cmd --permanent --add-port=5000/tcp
sudo firewall-cmd --reload
```

#### Windows (PowerShell - 管理者権限)

```powershell
New-NetFirewallRule -DisplayName "Train Tracker Web Server" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 5000 `
    -Action Allow
```

または、GUIで設定:
1. コントロールパネル → Windows Defender ファイアウォール
2. 詳細設定 → 受信の規則 → 新しい規則
3. ポート → TCP → 5000 → 接続を許可する

---

## 基本的な使い方

### 画面の見方

```
┌──────────────────────────────────────────────────┐
│ ヘッダー                                          │
│ ・ゲーム時刻、最終更新時刻、接続状態              │
└──────────────────────────────────────────────────┘
┌──────────────┬───────────────────────────────────┐
│ サイドバー   │ メインテーブル                     │
│              │                                   │
│ ・検索       │ 列車一覧を表形式で表示             │
│ ・路線フィルタ│                                   │
│ ・種別フィルタ│                                   │
│ ・更新ボタン │                                   │
│ ・統計情報   │                                   │
└──────────────┴───────────────────────────────────┘
```

### 検索機能の使い方

1. **テキスト検索**: サイドバーの検索ボックスに入力
   - 列車名、路線名、駅名で検索
   - 入力した瞬間にフィルタリング

2. **路線フィルタ**: 特定の路線のみ表示
   - チェックボックスで複数選択可能
   - 「全選択」「全解除」ボタンで一括操作

3. **線路種別フィルタ**: ドロップダウンで選択
   - 普通鉄道、モノレール、リニア、ナローゲージ、路面電車

### 表示項目の説明

| 列 | 説明 | 例 |
|----|------|-----|
| 列車名 | Convoy の名前 | 「急行101」 |
| 路線名 | Line の名前 | 「山手線」 |
| 現在位置 | X, Y, Z 座標 | 150, 200, 5 |
| 線路種別 | waytype の種類 | 「普通鉄道」 |
| 速度 | 現在の速度 (km/h) | 85 |
| 現在駅 | 現在のスケジュール地点 | 「東京駅」 |
| 次駅 | 次のスケジュール地点 | 「新橋駅」 |
| 状態 | 停車中 / 運行中 | 「運行中」 |

### 停車中の列車の見分け方

- **背景色**: 停車中の列車は黄色背景で表示されます
- **状態列**: 「停車中」と表示されます

---

## トラブルシューティング

### 1. JSON ファイルが生成されない

**症状**: `train_positions.json` が Simutrans ディレクトリに作成されない

**原因と対処法**:

1. **シナリオが読み込まれていない**
   - Simutransでシナリオメニューから `train_tracker/scenario.nut` を読み込んでください

2. **ファイル書き込み権限がない**
   - Simutransディレクトリに書き込み権限があるか確認
   - Windows: フォルダを右クリック → プロパティ → セキュリティ

3. **30秒経過していない**
   - シナリオ読み込み後、約30秒待ってください
   - コンソールに `[Train Tracker] Exported N trains` と表示されるはず

### 2. Webサーバーに接続できない

**症状**: ブラウザで `http://localhost:5000` にアクセスできない

**原因と対処法**:

1. **サーバーが起動していない**
   - ターミナル/コマンドプロンプトで `python server.py` を実行
   - エラーが出ていないか確認

2. **ポート5000が使用中**
   - `.env` で別のポート番号に変更（例: `PORT=5001`）

3. **ファイアウォールでブロックされている**
   - ファイアウォール設定を確認（上記の設定手順参照）

### 3. 認証エラー

**症状**: ユーザー名・パスワードを入力しても認証できない

**原因と対処法**:

1. **環境変数が読み込まれていない**
   - `.env` ファイルが `train_tracker_server/` ディレクトリにあるか確認
   - サーバーを再起動

2. **パスワードが間違っている**
   - `.env` の `AUTH_USERNAME` と `AUTH_PASSWORD` を確認
   - 特殊文字が含まれている場合、引用符で囲む

### 4. データが更新されない

**症状**: Webページのデータが古いまま

**原因と対処法**:

1. **Simutransが一時停止している**
   - ゲーム内で時間が進行しているか確認

2. **JSONファイルが更新されていない**
   - `train_positions.json` のタイムスタンプを確認
   - Simutransのコンソールでエラーが出ていないか確認

3. **ブラウザのキャッシュ**
   - Ctrl + F5 (Windows) / Cmd + Shift + R (Mac) でリロード

### 5. 外部からアクセスできない

**症状**: 同じネットワークの他の端末からアクセスできない

**原因と対処法**:

1. **サーバーのIPアドレスが間違っている**
   - サーバーのIPアドレスを確認: `ipconfig` (Windows) / `ip addr` (Linux)

2. **ファイアウォールでブロックされている**
   - ファイアウォール設定を確認（上記の設定手順参照）

3. **ルーターのポートフォワーディングが未設定**
   - インターネット経由でアクセスする場合、ルーターの設定が必要
   - ルーターの管理画面でポート5000を転送

---

## よくある質問 (FAQ)

### Q1. Simutrans本体のコードを変更する必要がありますか？

**A1**: いいえ、必要ありません。Squirrelスクリプトのみで実装されているため、Simutrans本体は一切変更不要です。

### Q2. NetSimutransでも使えますか？

**A2**: はい、使えます。サーバー側でシナリオを読み込めば、全プレイヤーの列車が表示されます。

### Q3. 更新間隔を変更できますか？

**A3**: はい、可能です。

Squirrelスクリプト側（Simutrans）:
- `simutrans/scenario/train_tracker/scenario.nut` の `export_interval_ticks` を変更

Webクライアント側（ブラウザ）:
- `train_tracker_server/static/app.js` の `UPDATE_INTERVAL` を変更（ミリ秒単位）

### Q4. HTTPSで接続できますか？

**A4**: Flaskは開発サーバーのためHTTPSは非推奨です。本番環境では、Nginxなどのリバースプロキシを使用してHTTPSを有効にすることをお勧めします。

### Q5. 複数のSimutransインスタンスを監視できますか？

**A5**: 各インスタンスごとに異なるポート番号でWebサーバーを起動すれば可能です。`.env` の `PORT` を変更してください。

### Q6. スマートフォンから見ることはできますか？

**A6**: はい、可能です。スマートフォンのブラウザでサーバーのIPアドレスとポート番号（例: `http://192.168.1.100:5000`）にアクセスしてください。

### Q7. 列車が表示されません

**A7**: 以下を確認してください:
1. Simutransで鉄道系の列車（rail, monorail, maglev, narrowgauge, tram）が走行している
2. 道路車両や船舶は表示対象外です
3. Depotに格納されている列車は表示されません

### Q8. パスワードを変更するには？

**A8**: `.env` ファイルの `AUTH_PASSWORD` を変更して、Webサーバーを再起動してください。

---

## サポート

問題が解決しない場合は、以下を確認してください:

1. [DEVELOPMENT.md](DEVELOPMENT.md) - 技術的な詳細
2. GitHub Issues - バグ報告や機能要望

---

**Happy Tracking! 🚆**
