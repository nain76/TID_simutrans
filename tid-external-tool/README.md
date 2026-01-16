# Simutrans 列車在線表示システム (TiD) - 外部ツール版

Simutrans OTRPのゲームコードを**一切変更せずに**、実行中のゲームから列車情報を読み取り、Webブラウザで表示する外部ツールです。

![TiD Screenshot](docs/screenshot-placeholder.png)

## 特徴

✅ **ゲームコード変更不要** - 完全外部ツール、Simutransは無改造
✅ **リアルタイム更新** - 3-5秒ごとに列車位置を更新
✅ **横長スクロール表示** - 実際の鉄道TiDシステムと同様のスタイル
✅ **外部PCからアクセス可能** - NetSimutransサーバーでの使用に最適
✅ **詳細な列車情報** - 列車名、スケジュール名、乗車率を表示

## 必要環境

### Windows
- Python 3.8以上
- Simutrans OTRP（実行中）
- 管理者権限（メモリアクセスのため）

### Linux
- Python 3.8以上
- Simutrans OTRP（実行中）
- root権限またはptrace権限

## クイックスタート

```bash
# 1. Python依存パッケージをインストール
pip install -r requirements.txt

# 2. オフセット設定を作成
python offset_discovery.py
# → config/offsets.json を手動で編集

# 3. TiDサーバーを起動
python tid_main.py

# 4. Webブラウザでアクセス
# http://localhost:8080
```

## 詳細インストール手順

### ステップ1: Pythonのインストール

#### Windows
1. https://www.python.org/downloads/ からPython 3.8以上をダウンロード
2. インストール時に「Add Python to PATH」にチェック
3. インストール完了後、コマンドプロンプトで確認:
   ```cmd
   python --version
   ```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install python3 python3-pip
python3 --version
```

### ステップ2: 依存パッケージのインストール

プロジェクトディレクトリで実行:

```bash
# Windows
pip install -r requirements.txt

# Linux
pip3 install -r requirements.txt
```

**requirements.txt の内容**:
```
pymem==1.13.1      # Windows only - メモリ読み取り
flask==3.0.0       # HTTPサーバー
flask-cors==4.0.0  # CORS対応
psutil==5.9.6      # プロセス管理
```

### ステップ3: オフセット設定

**重要**: Simutransのバージョンごとにメモリオフセットが異なります。

#### 3-A. テンプレートを生成

```bash
python offset_discovery.py
```

これにより `config/offsets.json` が生成されます。

#### 3-B. オフセット値を設定

`config/offsets.json` を編集して、正しいオフセット値を設定します。

**オフセットの見つけ方**:
1. Simutransのソースコードを参照
2. デバッガ（gdb/x64dbg）を使用
3. コミュニティで共有された設定をダウンロード（推奨）

詳細は `docs/offset_configuration.md` を参照してください。

### ステップ4: 設定ファイルの編集

`config/tid_config.json` を編集:

```json
{
  "server": {
    "host": "0.0.0.0",  // 外部アクセス可能
    "port": 8080
  },
  "scanner": {
    "process_name": "simutrans.exe",  // Linuxでは "simutrans"
    "update_interval_seconds": 4
  },
  "offsets_file": "config/offsets.json"
}
```

**設定パラメータ説明**:

| パラメータ | 説明 | デフォルト値 |
|-----------|------|-------------|
| `server.host` | HTTPサーバーのバインドアドレス。`0.0.0.0`で全インターフェース、`127.0.0.1`でローカルのみ | `0.0.0.0` |
| `server.port` | HTTPサーバーのポート番号 | `8080` |
| `scanner.process_name` | Simutransのプロセス名 | `simutrans.exe` |
| `scanner.update_interval_seconds` | メモリスキャン間隔（秒） | `4` |
| `offsets_file` | オフセット設定ファイルのパス | `config/offsets.json` |

## 使用方法

### 1. Simutransを起動

通常通りSimutransを起動してゲームを開始します。

### 2. TiDツールを起動

#### Windows（管理者権限で実行）
```cmd
python tid_main.py
```

管理者権限で実行するには:
1. コマンドプロンプトを右クリック
2. 「管理者として実行」を選択
3. プロジェクトディレクトリに移動
4. `python tid_main.py` を実行

#### Linux（root権限で実行）
```bash
sudo python3 tid_main.py
```

### 3. Webブラウザでアクセス

起動に成功すると以下のように表示されます:

```
============================================================
  Simutrans Train Information Display (TiD)
  列車在線表示システム - 外部ツール版
============================================================

  プロセス名:       simutrans.exe
  サーバーアドレス: 0.0.0.0:8080
  更新間隔:         4秒
  オフセット設定:   config/offsets.json

Simutransプロセスに接続中...
✓ Attached to process 'simutrans.exe' (PID: 12345)
✓ Loaded offset configuration (version: 123.0.1)
✓ Starting memory scanner (update interval: 4s)

============================================================
  TiD Server starting on http://0.0.0.0:8080
============================================================

  ローカルアクセス:     http://localhost:8080
  外部PCからアクセス:   http://[サーバーIP]:8080

  ※ファイアウォールでポート8080を開放してください

  Ctrl+C で停止
============================================================
```

**ローカルアクセス**:
```
http://localhost:8080
```

**外部PCからアクセス** (NetSimutransサーバーなど):
```
http://192.168.1.100:8080
```

サーバーのIPアドレスを確認:
- Windows: `ipconfig`
- Linux: `ip addr` または `hostname -I`

### 4. TiD画面の見方

```
┌──────────────────────────────────────────────────────────┐
│ Simutrans TiD    23:45:00  列車数: 15  ⚫ 接続中          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Tokyo●━━━━━Shinagawa●━━━━━Yokohama●━━━━━Odawara●━━━→ │
│   [Train01]       [Train02]                [Train03]    │
│   [快速123]       [普通456]                [特急789]    │
│   ▓▓▓▓▓▓░░        ▓▓▓▓▓▓▓▓▓                ▓▓░░░░       │
│                                                          │
└──────────────────────────────────────────────────────────┘
          ← 横スクロール →
```

**表示要素**:
- **緑の箱**: 通常運転中の列車
- **オレンジの箱**: 停車中/積載中の列車
- **赤の箱**: 高積載率（90%以上）の列車
- **白い線**: 線路（駅間を接続）
- **黄色い丸**: 駅の位置
- **バー**: 乗車率インジケーター（緑→黄→橙→赤）

## トラブルシューティング

### プロセスが見つからない

```
✗ エラー: Process 'simutrans.exe' not found. Make sure Simutrans is running.
```

**解決策**:
1. Simutransが実行中か確認
2. `config/tid_config.json` の `process_name` を確認
3. タスクマネージャー（Windows）または `ps aux | grep simutrans`（Linux）でプロセス名を確認

Linuxの場合、プロセス名は通常 `simutrans` (拡張子なし)

### 権限エラー

```
PermissionError: [Errno 1] Operation not permitted
```

**解決策**:
- **Windows**: 管理者権限で実行（コマンドプロンプトを「管理者として実行」）
- **Linux**: `sudo python3 tid_main.py` で実行

### データが表示されない

**症状**: ブラウザに列車が表示されない、または文字化け

**原因**: オフセット設定が間違っている

**解決策**:
1. `config/offsets.json` の値を確認
2. Simutransのバージョンとアーキテクチャ（32bit/64bit）を確認
3. 正しいバージョン用のオフセット設定を使用
4. コミュニティで共有されたオフセット設定をダウンロード

### 外部PCからアクセスできない

**解決策**:
1. **ファイアウォールでポート8080を開放**
   - Windows: Windowsファイアウォールの詳細設定で受信規則を追加
   - Linux: `sudo ufw allow 8080` または `sudo firewall-cmd --add-port=8080/tcp`

2. **設定を確認**
   - `config/tid_config.json` で `host` が `0.0.0.0` になっているか確認

3. **サーバーIPアドレスを確認**
   - Windows: `ipconfig`
   - Linux: `ip addr` または `hostname -I`

4. **ネットワーク接続を確認**
   - 同じネットワーク（LAN）にいるか確認
   - ルーターのポートフォワーディング設定（インターネット越しにアクセスする場合）

### ブラウザに「サーバーに接続できません」と表示される

**解決策**:
1. TiDサーバーが起動しているか確認
2. URLが正しいか確認（`http://localhost:8080`）
3. ブラウザのコンソール（F12キー）でエラーを確認
4. サーバー側のログを確認

## 高度な設定

### カスタムポート

```bash
python tid_main.py --port 9000
```

### 異なるプロセス名

```bash
python tid_main.py --process "simutrans-otrp"
```

### 更新間隔の変更

```bash
python tid_main.py --interval 3  # 3秒ごとに更新
```

### すべてのオプション

```bash
python tid_main.py --help
```

## オフセット設定の詳細

### offsets.jsonファイル形式

```json
{
  "version": "123.0.1",
  "architecture": "x64",
  "offsets": {
    "karte_t": {
      "convoi_array": "0x12A8",
      "halt_array": "0x12C0"
    },
    "convoi_t": {
      "id": "0x08",
      "name": "0x0C",
      "position": "0x10",
      "speed": "0x1C",
      "state": "0x20",
      "schedule": "0x28",
      "vehicles": "0x30"
    },
    "vehicle_t": {
      "cargo_max": "0x40",
      "cargo_loaded": "0x44"
    },
    "haltestelle_t": {
      "name": "0x08",
      "position": "0x10"
    }
  }
}
```

### オフセットパラメータの説明

#### `karte_t`（ワールドオブジェクト）

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `convoi_array` | 列車配列へのオフセット | `0x12A8` |
| `halt_array` | 駅配列へのオフセット | `0x12C0` |

#### `convoi_t`（列車オブジェクト）

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `id` | 列車IDへのオフセット | `0x08` |
| `name` | 列車名へのポインタのオフセット | `0x0C` |
| `position` | 現在位置(koord3d)へのオフセット | `0x10` |
| `speed` | 現在速度へのオフセット | `0x1C` |
| `state` | 状態(DRIVING, LOADING等)へのオフセット | `0x20` |
| `schedule` | スケジュールへのポインタのオフセット | `0x28` |
| `vehicles` | 車両配列へのオフセット | `0x30` |

#### `vehicle_t`（車両オブジェクト）

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `cargo_max` | 最大積載量へのオフセット | `0x40` |
| `cargo_loaded` | 現在積載量へのオフセット | `0x44` |

#### `haltestelle_t`（駅オブジェクト）

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `name` | 駅名へのオフセット | `0x08` |
| `position` | 駅位置へのオフセット | `0x10` |

### バージョン変更時の対応

Simutransを新しいバージョンに更新した場合:

```bash
# 1. オフセット設定を再作成
python offset_discovery.py

# 2. config/offsets.json を編集して正しいオフセットを設定

# 3. TiDサーバーを再起動
python tid_main.py
```

**所要時間**: 5-10分程度

## 制限事項

1. **バージョン依存**: Simutransのバージョンが変わるとオフセット再設定が必要
2. **アーキテクチャ依存**: 32bit版と64bit版でオフセットが異なる
3. **プラットフォーム依存**: Windows/Linuxで実装が異なる
4. **安定性**: メモリ読み取りはゲームを不安定にする可能性がある（低確率）
5. **マルチプレイヤー**: 各クライアントで別々に実行する必要がある
6. **権限**: 管理者/root権限が必要

## よくある質問（FAQ）

### Q1: ゲームコードを変更する必要はありますか？

**A**: いいえ、ゲームコードは一切変更不要です。このツールは完全に外部から動作します。

### Q2: Simutransを更新したらデータが表示されなくなりました

**A**: Simutransのバージョンが変わった可能性があります。`python offset_discovery.py` を実行して、オフセット設定を更新してください。

### Q3: 外部PCからアクセスできません

**A**: ファイアウォールでポート8080を開放してください。また、`config/tid_config.json` で `host` が `0.0.0.0` になっているか確認してください。

### Q4: 列車名が文字化けします

**A**: オフセット設定が間違っている可能性があります。正しいバージョン用のオフセットを使用してください。

### Q5: スケジュール名が表示されません

**A**: 現在のバージョンでは、スケジュール名の抽出は部分的にのみ実装されています。将来のバージョンで改善予定です。

### Q6: どのくらいの頻度でオフセットを更新する必要がありますか？

**A**: Simutransのバージョンを変更した時のみです。同じバージョンを使い続ける限り、再設定は不要です。

### Q7: NetSimutransサーバーで使えますか？

**A**: はい、サーバー上でTiDツールを実行すれば、クライアントPCのブラウザからアクセスできます。

## ライセンス

MIT License

## サポート

問題が発生した場合:
1. `config/offsets.json` を確認
2. このREADMEのトラブルシューティングセクションを確認
3. `docs/offset_configuration.md` を参照
4. GitHubでissueを作成

## 謝辞

Simutrans OTRP開発チームに感謝します。

## 関連ドキュメント

- `docs/offset_configuration.md` - オフセット設定の詳細ガイド
- `/root/.claude/plans/wild-purring-forest.md` - 実装計画書
