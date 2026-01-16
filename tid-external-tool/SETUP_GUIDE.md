# Simutrans TiD - セットアップガイド

## 実装完了！

Simutrans 列車在線表示システム（TiD）外部ツールの実装が完了しました。

## プロジェクト構造

```
simutrans-tid-external/
├── README.md                       # 完全な日本語マニュアル
├── SETUP_GUIDE.md                  # このファイル
├── requirements.txt                # Python依存パッケージ
│
├── tid_main.py                     # メインプログラム（実行ファイル）
├── memory_scanner.py               # メモリスキャナー実装
├── tid_server.py                   # HTTPサーバー実装
├── offset_discovery.py             # オフセット検出ツール
│
├── config/
│   ├── tid_config.json             # ユーザー設定ファイル
│   ├── offsets.json.template       # オフセット設定テンプレート
│   └── offsets/                    # バージョン別オフセット（今後追加）
│
├── web/
│   ├── index.html                  # Web UI（HTML）
│   ├── style.css                   # Web UI（スタイル）
│   └── tid.js                      # Web UI（JavaScriptロジック）
│
└── docs/
    └── offset_configuration.md     # オフセット設定詳細ガイド
```

## クイックスタート（5ステップ）

### 1. Python依存パッケージをインストール

```bash
cd /home/user/simutrans-tid-external
pip install -r requirements.txt
```

**Windows**:
```cmd
pip install -r requirements.txt
```

**Linux**:
```bash
pip3 install -r requirements.txt
```

### 2. オフセット設定を作成

```bash
python offset_discovery.py
```

これにより `config/offsets.json` が生成されます。

### 3. オフセット値を編集

`config/offsets.json` を編集して、お使いのSimutransバージョンに合わせた正しいオフセット値を設定してください。

詳細は `docs/offset_configuration.md` を参照してください。

### 4. Simutransを起動

通常通りSimutransを起動してゲームを開始します。

### 5. TiDサーバーを起動

**Windows（管理者権限で実行）**:
```cmd
python tid_main.py
```

**Linux（root権限で実行）**:
```bash
sudo python3 tid_main.py
```

### 6. Webブラウザでアクセス

```
http://localhost:8080
```

## 設定パラメータ

### config/tid_config.json

```json
{
  "server": {
    "host": "0.0.0.0",              // バインドアドレス（全インターフェース）
    "port": 8080                    // ポート番号
  },
  "scanner": {
    "process_name": "simutrans.exe", // プロセス名（Linuxでは "simutrans"）
    "update_interval_seconds": 4     // メモリスキャン間隔（秒）
  },
  "offsets_file": "config/offsets.json" // オフセット設定ファイル
}
```

### config/offsets.json

```json
{
  "version": "123.0.1",               // Simutransバージョン
  "architecture": "x64",              // アーキテクチャ（x64 or x86）
  "offsets": {
    "karte_t": {
      "convoi_array": "0x12A8"      // 列車配列オフセット
    },
    "convoi_t": {
      "id": "0x08",                 // 列車ID
      "name": "0x10",               // 列車名ポインタ
      "position": "0x18",           // 現在位置
      "speed": "0x24"               // 現在速度
    }
  }
}
```

## トラブルシューティング

### Q: プロセスが見つからない

**エラー**:
```
✗ エラー: Process 'simutrans.exe' not found.
```

**解決策**:
1. Simutransが起動しているか確認
2. プロセス名が正しいか確認（Linuxでは `simutrans`、拡張子なし）

### Q: 権限エラー

**エラー**:
```
PermissionError: [Errno 1] Operation not permitted
```

**解決策**:
- Windows: 管理者権限で実行
- Linux: `sudo python3 tid_main.py`

### Q: データが表示されない

**原因**: オフセット設定が間違っている

**解決策**:
1. `config/offsets.json` の値を確認
2. 正しいバージョン用のオフセットを使用
3. `docs/offset_configuration.md` を参照

### Q: 外部PCからアクセスできない

**解決策**:
1. ファイアウォールでポート8080を開放
2. `config/tid_config.json` で `host` が `0.0.0.0` になっているか確認
3. サーバーのIPアドレスを確認

## 次のステップ

1. **README.md を読む** - 完全なマニュアル
2. **docs/offset_configuration.md を読む** - オフセット設定の詳細
3. **テスト実行** - Simutransを起動してTiDを試す
4. **オフセット共有** - 動作するオフセット設定をコミュニティで共有

## 重要なファイル

| ファイル | 説明 | 編集 |
|---------|------|------|
| `README.md` | 完全な日本語マニュアル | 読む |
| `config/tid_config.json` | ユーザー設定 | 必要に応じて編集 |
| `config/offsets.json` | オフセット設定 | **必ず編集が必要** |
| `docs/offset_configuration.md` | オフセット詳細ガイド | 読む |
| `/root/.claude/plans/wild-purring-forest.md` | 実装計画書 | 参照用 |

## 技術スタック

- **Backend**: Python 3.8+
- **Memory Reading**: pymem (Windows) / /proc/pid/mem (Linux)
- **HTTP Server**: Flask 3.0.0
- **Frontend**: Vanilla JavaScript + HTML5 Canvas
- **Config**: JSON

## 機能

✅ メモリスキャン（3-5秒間隔）
✅ JSON API（/api/trains, /api/config）
✅ Web UI（青背景、横長スクロール）
✅ リアルタイム列車表示
✅ 列車情報（名前、スケジュール、乗車率）
✅ 外部PCアクセス対応
✅ 完全外部ツール（ゲームコード無改造）

## 制限事項

⚠ バージョン依存（オフセット再設定が必要）
⚠ 管理者/root権限が必要
⚠ プラットフォーム依存（Windows/Linux）
⚠ 32bit/64bit別設定

## ライセンス

MIT License

## サポート

問題が発生した場合:
1. `README.md` のトラブルシューティングを確認
2. `docs/offset_configuration.md` を参照
3. GitHubでissueを作成

## 謝辞

Simutrans OTRP開発チームに感謝します。
