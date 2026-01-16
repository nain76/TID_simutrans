# オフセット設定ガイド

## 目次
1. [オフセットとは](#オフセットとは)
2. [なぜオフセットが必要か](#なぜオフセットが必要か)
3. [オフセットの見つけ方](#オフセットの見つけ方)
4. [バージョン別設定例](#バージョン別設定例)
5. [トラブルシューティング](#トラブルシューティング)

## オフセットとは

**オフセット**とは、メモリ内のデータ構造の開始位置からの相対的な距離（バイト数）です。

### 例

```
メモリ内の convoi_t オブジェクト（開始アドレス: 0x12345000）
  +0x00: vtable pointer    ← オブジェクトの先頭
  +0x08: id (int32)         ← オフセット 0x08
  +0x0C: name (char*)       ← オフセット 0x0C
  +0x10: position (koord3d) ← オフセット 0x10
  +0x1C: speed (sint32)     ← オフセット 0x1C
  ...
```

列車IDを読み取るには、convoi_tオブジェクトのアドレスに**+0x08**したアドレスから4バイトを読めばよいということです。

## なぜオフセットが必要か

Simutransのソースコードが変更されるたびに、クラスのメンバー変数の配置が変わる可能性があります。

### バージョン間の変化の例

```cpp
// バージョン 123.0
class convoi_t {
    uint32 id;           // +0x08
    char* name;          // +0x10 (64bit)
    koord3d position;    // +0x18
    sint32 speed;        // +0x24
};

// バージョン 124.0（新しいメンバーが追加された）
class convoi_t {
    uint32 id;           // +0x08 （変わらず）
    char* name;          // +0x10 （変わらず）
    uint8 new_flag;      // +0x18 （新規追加！）
    koord3d position;    // +0x1C （ずれた！）
    sint32 speed;        // +0x28 （ずれた！）
};
```

このため、バージョンごとに正しいオフセットを設定する必要があります。

## オフセットの見つけ方

### 方法1: コミュニティの設定を利用（最も簡単）

**推奨される方法です。**

1. GitHubやフォーラムで、あなたのSimutransバージョン用のオフセット設定を探す
2. `config/offsets/` ディレクトリにダウンロード
3. `config/offsets.json` にコピー

```bash
# 例: Simutrans 123.0.1 (x64) 用
cp config/offsets/simutrans-123.0.1-x64.json config/offsets.json
```

### 方法2: Simutransソースコードから推測

Simutrans OTRPのソースコードが手元にある場合:

1. 対象クラスのヘッダーファイルを確認（例: `simconvoi.h`）
2. メンバー変数の宣言順序とサイズから計算

```cpp
class convoi_t : public sync_steppable {
    // 継承クラスのメンバー（サイズ不明）

    uint32 id;              // +0x?? (4 bytes)
    char* name;             // +0x?? (8 bytes on x64, 4 bytes on x86)
    koord3d position;       // +0x?? (5 bytes: x=2, y=2, z=1)
    sint32 speed;           // +0x?? (4 bytes)
    // ...
}
```

**注意**:
- コンパイラの最適化やパディングにより、実際のオフセットは推測と異なる場合があります
- 継承元のクラスサイズが不明な場合、正確な計算は困難です

### 方法3: デバッガを使用（上級者向け）

#### 必要なツール
- **Windows**: x64dbg または WinDbg
- **Linux**: gdb

#### 手順（gdbの例）

1. Simutransをデバッガで起動

```bash
gdb simutrans
```

2. ブレークポイントを設定

Simutransのソースコードを参照して、関連する関数にブレークポイントを設定します。

```gdb
# 例: convoi_t::step() 関数
break convoi_t::step
run
```

3. convoi_tオブジェクトのアドレスを確認

```gdb
# thisポインタを表示
print this
# 出力例: $1 = (convoi_t *) 0x7ffff0001000
```

4. メンバー変数のアドレスを確認

```gdb
# 各メンバーのアドレスを表示
print &this->id
print &this->name
print &this->position
print &this->speed
```

5. オフセットを計算

```
オフセット = メンバー変数のアドレス - オブジェクトの開始アドレス

例:
  thisアドレス:     0x7ffff0001000
  this->idアドレス: 0x7ffff0001008
  → オフセット = 0x1008 - 0x1000 = 0x08
```

#### x64dbgの場合（Windows）

1. x64dbg.exe を起動
2. File → Open → simutrans.exe を選択
3. 適切な場所にブレークポイントを設定
4. 実行してブレーク
5. メモリビューアーでオブジェクトを確認
6. オフセットを計算

### 方法4: 自動検出ツール（将来実装予定）

現在開発中の機能です。将来のバージョンでは、ツールが自動的にオフセットを検出する予定です。

## オフセット設定ファイルの書き方

### ファイル形式

```json
{
  "comment": "Simutrans OTRP メモリオフセット設定",
  "version": "123.0.1",
  "architecture": "x64",

  "offsets": {
    "karte_t": {
      "convoi_array": "0x12A8",
      "halt_array": "0x12C0"
    },
    "convoi_t": {
      "id": "0x08",
      "name": "0x10",
      "position": "0x18",
      "speed": "0x24",
      "state": "0x28",
      "schedule": "0x30",
      "vehicles": "0x38"
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

### パラメータの詳細

#### メタ情報

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `version` | Simutransのバージョン | `"123.0.1"` |
| `architecture` | CPUアーキテクチャ | `"x64"` または `"x86"` |

#### karte_t（ワールドオブジェクト）

| オフセット | 説明 | データ型 |
|-----------|------|----------|
| `convoi_array` | 列車配列（vector_tpl）へのオフセット | ポインタ |
| `halt_array` | 駅配列（vector_tpl）へのオフセット | ポインタ |

#### convoi_t（列車オブジェクト）

| オフセット | 説明 | データ型 | サイズ |
|-----------|------|----------|--------|
| `id` | 列車ID | uint32 | 4 bytes |
| `name` | 列車名へのポインタ | char* | 8 bytes (x64) |
| `position` | 現在位置 | koord3d | 5 bytes |
| `speed` | 現在速度 | sint32 | 4 bytes |
| `state` | 状態（DRIVING等） | enum | 4 bytes |
| `schedule` | スケジュールへのポインタ | schedule_t* | 8 bytes (x64) |
| `vehicles` | 車両配列 | vector_tpl | 可変 |

#### vehicle_t（車両オブジェクト）

| オフセット | 説明 | データ型 | サイズ |
|-----------|------|----------|--------|
| `cargo_max` | 最大積載量 | uint16 | 2 bytes |
| `cargo_loaded` | 現在積載量 | uint16 | 2 bytes |

#### haltestelle_t（駅オブジェクト）

| オフセット | 説明 | データ型 | サイズ |
|-----------|------|----------|--------|
| `name` | 駅名 | char* | 8 bytes (x64) |
| `position` | 駅位置 | koord | 4 bytes |

## バージョン別設定例

### Simutrans 123.0.1 (x64)

```json
{
  "version": "123.0.1",
  "architecture": "x64",
  "offsets": {
    "karte_t": {
      "convoi_array": "0x12A8"
    },
    "convoi_t": {
      "id": "0x10",
      "name": "0x18",
      "position": "0x24",
      "speed": "0x30"
    }
  }
}
```

### Simutrans 122.0 (x64)

```json
{
  "version": "122.0",
  "architecture": "x64",
  "offsets": {
    "karte_t": {
      "convoi_array": "0x1290"
    },
    "convoi_t": {
      "id": "0x10",
      "name": "0x18",
      "position": "0x24",
      "speed": "0x30"
    }
  }
}
```

### 32bit版と64bit版の違い

```json
// 32bit版
{
  "architecture": "x86",
  "offsets": {
    "convoi_t": {
      "name": "0x0C",     // ポインタ4バイト
      "position": "0x10"
    }
  }
}

// 64bit版
{
  "architecture": "x64",
  "offsets": {
    "convoi_t": {
      "name": "0x10",     // ポインタ8バイト
      "position": "0x18"  // 位置がずれる
    }
  }
}
```

## トラブルシューティング

### データが正しく読み取れない

**症状**: 列車名が文字化けする、位置が異常な値になる

**原因**: オフセットが間違っている

**解決策**:
1. Simutransのバージョンを確認
2. 正しいバージョン用のオフセット設定を使用
3. アーキテクチャ（32bit/64bit）を確認
4. デバッガで実際のオフセットを確認

### ツール起動時にクラッシュする

**症状**: TiDツール実行中にSimutransがクラッシュ

**原因**: 無効なメモリアドレスにアクセスしている

**解決策**:
1. オフセット設定を再確認
2. より保守的な値を試す
3. Simutransのビルド設定（Debug/Release）を確認

### 列車数が0と表示される

**症状**: ブラウザに「列車数: 0」と表示される

**原因**: `convoi_array` のオフセットが間違っている

**解決策**:
1. `karte_t.convoi_array` のオフセットを確認
2. デバッガで正しいアドレスを特定
3. 他のユーザーの設定を参考にする

## ベストプラクティス

### 1. バージョン管理

オフセット設定をバージョン別に保存:

```
config/offsets/
├── simutrans-123.0.1-x64.json
├── simutrans-123.0.1-x86.json
├── simutrans-122.0-x64.json
└── ...
```

### 2. コメントを追加

```json
{
  "version": "123.0.1",
  "comment": "2024-01-15に確認。デバッガで検証済み",
  "tested_by": "YourName",
  "offsets": {
    ...
  }
}
```

### 3. コミュニティで共有

動作確認できたオフセット設定は、GitHubやフォーラムで共有しましょう。

### 4. バックアップ

動作する設定ファイルは必ずバックアップを取りましょう。

## さらなる情報

- Simutrans OTRP ソースコード: https://github.com/teamhimeh/simutrans
- x64dbg: https://x64dbg.com/
- GDB Documentation: https://www.gnu.org/software/gdb/documentation/

## コミュニティへの貢献

新しいSimutransバージョンのオフセット設定を見つけた場合:

1. `config/offsets/simutrans-[version]-[arch].json` ファイルを作成
2. テストして動作を確認
3. GitHubでプルリクエストを作成、またはフォーラムで共有

コミュニティ全体の利益になります！
