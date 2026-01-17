# 列車位置追跡システム / Train Position Tracker

Simutrans OTRPで走行中の列車の位置をWeb上でリアルタイムに確認できるシステムです。

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey)

## 特徴

- ✅ **本体コード変更不要**: Squirrelスクリプトで実装、Simutrans本体のビルドは不要
- 🌐 **Webブラウザで表示**: 任意の端末からブラウザでアクセス可能
- 🔒 **Basic認証対応**: ユーザー名・パスワードでアクセス制御
- 📊 **横長レイアウト**: ワイドスクリーン最適化されたUI
- 🔍 **高機能フィルタ**: 路線、検索、線路種別での絞り込み
- 🚆 **鉄道系+トラム対応**: rail, monorail, maglev, narrowgauge, tram
- 💻 **クロスプラットフォーム**: Windows / Linux両対応

## システム構成

```
Simutrans (ゲーム)
    ↓ Squirrelスクリプト (30秒ごと)
train_positions.json (共有ファイル)
    ↓ ファイル読み込み
Python Flask Webサーバー
    ↓ HTTP/JSON API
Webブラウザ (HTML/CSS/JS)
```

## クイックスタート

### 必要なもの

- Simutrans OTRP (本体)
- Python 3.8以降
- Webブラウザ（Chrome, Firefox, Edge など）

### インストール（5分で完了）

#### 1. AIスクリプトの配置

**Linux:**
```bash
cd /path/to/simutrans
cp -r simutrans/ai/train_tracker ai/
```

**Windows:**
```cmd
cd C:\path\to\simutrans
xcopy /E /I simutrans\ai\train_tracker ai\train_tracker
```

#### 2. Webサーバーのセットアップ

```bash
# 依存関係をインストール
cd train_tracker_server
pip install -r requirements.txt

# 環境変数を設定
cp .env.example .env
# .env を編集してJSON_PATHとパスワードを設定
```

#### 3. SimutransでAIスクリプトを読み込み

1. Simutransを起動（既存ゲームまたは新規ゲーム）
2. 新しいAIプレイヤーを追加
3. AIスクリプトで `train_tracker` を選択

#### 4. Webサーバーを起動

```bash
python server.py
```

#### 5. ブラウザでアクセス

```
http://localhost:5000
```

ユーザー名とパスワードを入力してログイン！

## 表示項目

| 項目 | 説明 |
|------|------|
| 列車名 | convoy.get_name() |
| 路線名 | Line名（無所属の場合は「無所属」） |
| 現在位置 | X, Y, Z座標 |
| 線路種別 | 普通鉄道、モノレール、リニア、ナローゲージ、路面電車 |
| 速度 | 現在の速度 (km/h) |
| 現在駅 | スケジュールから取得 |
| 次駅 | 次に停車する駅 |
| 状態 | 停車中 / 運行中 |

## 主な機能

### フィルタ機能
- **検索**: 列車名、路線名、駅名で検索
- **路線フィルタ**: 複数路線をチェックボックスで選択
- **線路種別フィルタ**: 種別で絞り込み

### 自動更新
- 5秒ごとに自動でデータを取得
- 手動更新ボタンも用意

### レスポンシブ対応
- デスクトップ: サイドバー + メインテーブル
- モバイル: 縦並び表示

## ドキュメント

- **[使い方説明書](USER_GUIDE.md)** - インストールと使い方の詳細
- **[開発ドキュメント](DEVELOPMENT.md)** - アーキテクチャと実装詳細

## トラブルシューティング

### データが表示されない

1. SimutransでAIスクリプトが読み込まれているか確認（AIプレイヤー一覧に表示されているか）
2. `train_positions.json` が生成されているか確認
3. `.env` の `JSON_PATH` が正しいか確認

### Webサーバーに接続できない

1. サーバーが起動しているか確認
2. ポート5000が他のアプリで使用されていないか確認
3. ファイアウォールの設定を確認

詳細は [USER_GUIDE.md](USER_GUIDE.md) のトラブルシューティングを参照してください。

## ライセンス

MIT License

## 作者

Created with Claude Code

## 貢献

プルリクエストを歓迎します！詳細は [DEVELOPMENT.md](DEVELOPMENT.md) を参照してください。
