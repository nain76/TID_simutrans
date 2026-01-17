# 列車位置追跡システム - 開発ドキュメント

本書は、列車位置追跡システムの技術的な詳細、アーキテクチャ、実装の背景、カスタマイズ方法について説明します。

## 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [実装の詳細](#実装の詳細)
3. [設計判断の理由](#設計判断の理由)
4. [カスタマイズガイド](#カスタマイズガイド)
5. [コントリビューションガイド](#コントリビューションガイド)

---

## アーキテクチャ概要

### システム構成図

```
┌──────────────────────────────────────────────┐
│           Simutrans OTRP (C++)                │
│  ┌────────────────────────────────────────┐  │
│  │   Squirrel VM (Embedded Scripting)    │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │  scenario.nut (Main Script)     │  │  │
│  │  │  - Convoy API access            │  │  │
│  │  │  - Line API access              │  │  │
│  │  │  - JSON generation              │  │  │
│  │  │  - File I/O                     │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────┘
                   │ writes (every 30 sec)
                   ↓
         ┌─────────────────────┐
         │ train_positions.json│ ← Shared data file
         └──────────┬──────────┘
                    │ reads (on request)
                    ↓
┌──────────────────────────────────────────────┐
│       Python Flask Web Server                │
│  ┌────────────────────────────────────────┐  │
│  │  server.py (Flask App)                │  │
│  │  - Basic Authentication               │  │
│  │  - REST API Endpoints                 │  │
│  │  - Static File Serving                │  │
│  └────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────┘
                   │ HTTP/JSON
                   ↓
┌──────────────────────────────────────────────┐
│          Web Browser (Client)                │
│  ┌────────────────────────────────────────┐  │
│  │  index.html + style.css + app.js      │  │
│  │  - Data fetching (polling)            │  │
│  │  - Filtering & searching              │  │
│  │  - Responsive UI                      │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### データフロー

```
1. Squirrel Script (Simutrans内)
   ↓
   world.get_convoy_list() → Convoy API
   ↓
   convoy.get_pos(), convoy.get_line(), etc.
   ↓
   JSON文字列を生成
   ↓
   file("train_positions.json", "w").writestr(json)

2. Flask Server
   ↓
   open("train_positions.json", "r") → JSON読み込み
   ↓
   jsonify(data) → HTTPレスポンス

3. Web Client (JavaScript)
   ↓
   fetch("/api/trains") → サーバーにリクエスト
   ↓
   data.trains.forEach(...) → テーブル更新
   ↓
   setTimeout(fetch, 5000) → 5秒後に再取得
```

### 技術スタック選定理由

| 技術 | 理由 |
|------|------|
| **Squirrel** | Simutrans組み込みスクリプト言語、本体変更不要 |
| **JSON** | シンプルなデータ交換フォーマット、言語非依存 |
| **Python Flask** | 軽量Webフレームワーク、簡単にREST API構築可能 |
| **Vanilla JS** | フレームワーク不要、高速で軽量 |

---

## 実装の詳細

### 1. Squirrel API の使用方法

#### Convoy API

Simutrans OTRP の Squirrel API は `/script/api/api_convoy.cc` で実装されています。

**主要メソッド:**

```squirrel
// Convoy一覧を取得
local convoy_list = world.get_convoy_list()

// Convoyの詳細情報
foreach (convoy in convoy_list) {
    local name = convoy.get_name()          // string: Convoy名
    local pos = convoy.get_pos()            // koord3d: {x, y, z}
    local speed = convoy.get_speed()        // integer: km/h
    local waytype = convoy.get_waytype()    // enum: wt_rail, wt_monorail, etc.
    local is_loading = convoy.is_loading()  // bool: 停車中か
    local line = convoy.get_line()          // linehandle_t: Line オブジェクト
    local schedule = convoy.get_schedule()  // schedule_t: Schedule オブジェクト
}
```

**waytype enum 値** (`simconst.nut` で定義):
- `wt_rail` = 1
- `wt_monorail` = 5
- `wt_maglev` = 6
- `wt_narrowgauge` = 7
- `wt_tram` = 8

#### Line API

```squirrel
local line = convoy.get_line()
if (line && line.is_valid()) {
    local line_name = line.get_name()  // string: Line名
}
```

#### Schedule API

```squirrel
local schedule = convoy.get_schedule()
if (schedule) {
    local entries = schedule.entries  // array: スケジュールエントリ
    foreach (entry in entries) {
        local pos = entry.pos  // koord3d: 停車位置
        // Halt オブジェクトの取得は複雑なため、座標から推定
    }
}
```

### 2. JSON フォーマット仕様

#### エクスポートされるJSON構造

```json
{
  "timestamp": "simutrans-1950-03",
  "game_time": {
    "year": 1950,
    "month": 2,
    "ticks": 123456
  },
  "trains": [
    {
      "id": 0,
      "name": "急行101",
      "position": {
        "x": 150,
        "y": 200,
        "z": 5
      },
      "line": "山手線",
      "waytype": "rail",
      "waytype_ja": "普通鉄道",
      "speed_kmh": 85,
      "is_loading": false,
      "current_halt": "東京駅",
      "next_halt": "新橋駅"
    }
  ]
}
```

#### フィールド説明

| フィールド | 型 | 説明 |
|-----------|----|----|
| `timestamp` | string | エクスポート時刻（近似値） |
| `game_time.year` | integer | ゲーム内の年 |
| `game_time.month` | integer | ゲーム内の月 (0-11) |
| `game_time.ticks` | integer | ゲーム内ティック数 |
| `trains[].id` | integer | 配列内のインデックス |
| `trains[].name` | string | Convoy名 |
| `trains[].position` | object | X,Y,Z座標 |
| `trains[].line` | string | Line名 |
| `trains[].waytype` | string | 英語の waytype |
| `trains[].waytype_ja` | string | 日本語の waytype |
| `trains[].speed_kmh` | integer | 速度 (km/h) |
| `trains[].is_loading` | boolean | 停車中か |
| `trains[].current_halt` | string/null | 現在駅 |
| `trains[].next_halt` | string/null | 次駅 |

### 3. Flask API エンドポイント仕様

#### GET `/`

- **説明**: メインHTMLページを返す
- **認証**: 必須 (Basic Auth)
- **レスポンス**: `text/html`

#### GET `/api/trains`

- **説明**: 全列車データを返す
- **認証**: 必須 (Basic Auth)
- **レスポンス**: `application/json`

**成功レスポンス** (200):
```json
{
  "timestamp": "...",
  "game_time": {...},
  "trains": [...]
}
```

**エラーレスポンス** (200, エラー情報付き):
```json
{
  "timestamp": "...",
  "trains": [],
  "error": "Data file not found. Is Simutrans running with the scenario loaded?"
}
```

#### GET `/api/lines`

- **説明**: 全路線名の一覧を返す
- **認証**: 必須 (Basic Auth)
- **レスポンス**: `application/json`

**成功レスポンス** (200):
```json
{
  "lines": ["山手線", "中央線", "京浜東北線"]
}
```

#### GET `/api/health`

- **説明**: サーバーの状態を返す
- **認証**: 不要
- **レスポンス**: `application/json`

**成功レスポンス** (200):
```json
{
  "status": "ok",
  "data_file_exists": true,
  "data_file_path": "/path/to/train_positions.json",
  "data_file_age_seconds": 15.3,
  "data_file_size_bytes": 2048,
  "server_time": "2026-01-17T12:34:56.789"
}
```

---

## 設計判断の理由

### なぜ Squirrel スクリプトなのか

**選択肢:**
1. ✅ Squirrel スクリプト
2. ❌ C++ で本体を変更
3. ❌ 外部プロセスからメモリを読み取り

**理由:**
- **非侵襲的**: 本体コード変更不要、ビルド不要
- **公式サポート**: Squirrel VM は Simutrans に組み込み済み
- **安全性**: スクリプトエラーがゲームをクラッシュさせない
- **可搬性**: スクリプトファイルをコピーするだけで動作

### なぜファイルベース通信なのか

**選択肢:**
1. ✅ JSONファイル経由
2. ❌ Shared memory
3. ❌ Named pipes / Sockets
4. ❌ HTTP サーバー組み込み

**理由:**
- **シンプル**: ファイルI/Oは Squirrel でサポート済み
- **デバッグ容易**: JSONファイルを直接確認可能
- **クロスプラットフォーム**: Linux/Windows で動作
- **疎結合**: SimutransとWebサーバーが独立して動作

### なぜ Flask を選んだのか

**選択肢:**
1. ✅ Python Flask
2. ❌ Node.js + Express
3. ❌ Go (net/http)
4. ❌ Nginx (静的ファイルのみ)

**理由:**
- **軽量**: 最小限の依存関係
- **Python**: 多くの環境でプリインストール済み
- **柔軟性**: 簡単にカスタマイズ可能
- **学習コスト低**: Pythonの知識があれば理解しやすい

### 30秒更新間隔の理由

**選択肢:**
1. ❌ 1秒ごと
2. ❌ 10秒ごと
3. ✅ 30秒ごと
4. ❌ 1分ごと

**理由:**
- **パフォーマンス**: 1秒ごとはファイルI/Oオーバーヘッド大
- **リアルタイム性**: 30秒でも十分に実用的
- **Simutransの速度**: ゲーム内時間の進行速度を考慮
- **ネットワーク負荷**: クライアント側は5秒ポーリングなので余裕あり

---

## カスタマイズガイド

### 1. 新しい表示項目の追加

#### ステップ1: Squirrelスクリプトで情報を取得

`simutrans/scenario/train_tracker/scenario.nut` を編集:

```squirrel
// 例: 編成長（車両数）を追加
local train_data = {
    // ... 既存のフィールド ...
    vehicle_count = convoy.get_vehicle_count()  // 追加
}
```

#### ステップ2: JSONに含める

JSON生成時に自動的に含まれます（`to_json` 関数が自動処理）。

#### ステップ3: フロントエンドで表示

`train_tracker_server/static/index.html`:
```html
<th>編成長</th>  <!-- テーブルヘッダーに追加 -->
```

`train_tracker_server/static/app.js`:
```javascript
<td>${train.vehicle_count || '-'}</td>  <!-- テーブルボディに追加 -->
```

### 2. 更新間隔の変更

#### Squirrelスクリプト側（Simutrans）

`simutrans/scenario/train_tracker/scenario.nut`:

```squirrel
config <- {
    // 60秒に変更する場合
    export_interval_ticks = 1200,  // 60秒 ≈ 1200 ticks
    // ...
}
```

**ティック計算式**:
```
ticks = seconds × 20
```

#### Webクライアント側（ブラウザ）

`train_tracker_server/static/app.js`:

```javascript
const UPDATE_INTERVAL = 10000;  // 10秒に変更 (ミリ秒単位)
```

### 3. UI のカスタマイズ

#### カラースキームの変更

`train_tracker_server/static/style.css` の `:root` セクション:

```css
:root {
    --primary-color: #2c3e50;     /* ← ここを変更 */
    --secondary-color: #34495e;
    --accent-color: #3498db;
    /* ... */
}
```

#### レイアウトの変更

サイドバーの幅を変更:

```css
:root {
    --sidebar-width: 320px;  /* デフォルト: 280px */
}
```

### 4. 新しい waytype の追加

#### ステップ1: waytype_translator.nut を編集

```squirrel
waytype_names_ja <- {
    [wt_rail] = "普通鉄道",
    // ... 既存のエントリ ...
    [wt_custom] = "カスタム軌道",  // 追加
}

waytype_names_en <- {
    [wt_rail] = "rail",
    // ... 既存のエントリ ...
    [wt_custom] = "custom",  // 追加
}

function should_track_waytype(wt) {
    return wt == wt_rail || wt == wt_monorail || wt == wt_maglev ||
           wt == wt_narrowgauge || wt == wt_tram || wt == wt_custom  // 追加
}
```

#### ステップ2: フロントエンドのフィルタに追加

`train_tracker_server/static/index.html`:

```html
<select id="filter-waytype">
    <option value="">全ての種別</option>
    <!-- ... 既存のオプション ... -->
    <option value="custom">カスタム軌道</option>  <!-- 追加 -->
</select>
```

### 5. Basic認証の無効化（開発用）

**警告**: 本番環境では推奨されません！

`train_tracker_server/server.py`:

```python
# デコレータを削除
@app.route('/')
# @requires_auth  ← コメントアウト
def index():
    return send_from_directory('static', 'index.html')
```

---

## コントリビューションガイド

### コーディング規約

#### Python (server.py)

- **スタイル**: PEP 8
- **インデント**: 4スペース
- **文字列**: ダブルクォート優先
- **型ヒント**: 可能な限り使用

```python
def get_trains() -> Response:
    """Docstring を必ず書く"""
    pass
```

#### JavaScript (app.js)

- **スタイル**: ES6+
- **インデント**: 4スペース
- **命名**: camelCase
- **セミコロン**: 必須

```javascript
function loadTrainData() {
    // コメントを適切に書く
    const data = await fetch(API_URL);
}
```

#### Squirrel (scenario.nut)

- **インデント**: 4スペース
- **命名**: snake_case
- **コメント**: 関数の前に説明を書く

```squirrel
/**
 * 関数の説明
 * @param convoy Convoy object
 */
function extract_schedule_info(train_data, schedule, convoy) {
    // ...
}
```

### テスト方法

#### 1. Squirrelスクリプトのテスト

1. Simutransで実際にシナリオを読み込む
2. コンソール出力を確認
3. `train_positions.json` の内容を確認

```bash
cat simutrans/train_positions.json | jq .
```

#### 2. Webサーバーのテスト

```bash
# API エンドポイントをテスト
curl -u admin:changeme http://localhost:5000/api/trains
curl http://localhost:5000/api/health
```

#### 3. フロントエンドのテスト

- Chrome DevTools でコンソールエラーを確認
- Network タブでAPI リクエストを確認
- 複数ブラウザで動作確認

### プルリクエストの出し方

1. **Fork** このリポジトリ
2. **Branch** を作成: `git checkout -b feature/your-feature`
3. **Commit**: `git commit -am 'Add some feature'`
4. **Push**: `git push origin feature/your-feature`
5. **Pull Request** を作成

**PRには以下を含めてください:**
- 変更内容の説明
- テスト方法
- スクリーンショット（UI変更の場合）

---

## パフォーマンス最適化

### Squirrelスクリプト

- ✅ Convoy数: 100-500編成で < 100ms
- ✅ ファイルI/O: バッファリングあり
- ⚠️ 1000編成を超える場合は間隔を延長推奨

### Webサーバー

- ✅ Flask: 10-50 req/s を処理可能
- ✅ JSONパース: ~1ms (100KB)
- 💡 本番環境では Gunicorn + Nginx を推奨

### フロントエンド

- ✅ ポーリング間隔: 5秒（調整可能）
- ✅ DOM更新: 差分更新ではなく全置換（シンプル優先）
- 💡 10000編成を超える場合は仮想スクロール導入を検討

---

**Happy Hacking! 🚀**
