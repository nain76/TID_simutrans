# Simutrans OTRP v50.1 オフセット設定ガイド

## 重要な注意事項

**メモリオフセットはソースコードだけからは決定できません。**

コンパイル済みバイナリの実際のメモリレイアウトに依存するため、以下のいずれかの方法で実際の値を見つける必要があります。

## 方法1: デバッガを使用（推奨・最も正確）

### Linux (gdb) の場合

#### ステップ1: Simutransをデバッガで起動

```bash
# Simutrans OTRP v50.1 のディレクトリに移動
cd /path/to/simutrans-otrp-v50.1

# gdb で起動
gdb ./simutrans

# gdb内で実行
(gdb) run
```

#### ステップ2: ゲームを開始

GDB内でSimutransが起動します。通常通りゲームを開始してください。

#### ステップ3: Ctrl+C で一時停止して列車を作成

1. ゲームで列車を1つ作成
2. ターミナルで Ctrl+C を押してデバッガで中断

#### ステップ4: オフセットを調査

```gdb
# karte_t オブジェクトのアドレスを取得
(gdb) print &karte_t::world
(gdb) set $karte = *(karte_t**)&karte_t::world

# convoi_array のオフセットを計算
(gdb) print &($karte->convoi_array)
(gdb) print (char*)&($karte->convoi_array) - (char*)$karte

# 結果の例: $1 = 0x1234  ← これがオフセット！
```

この値を `config/offsets.json` の `karte_t.convoi_array` に設定します。

#### ステップ5: convoi_t のオフセットを調査

```gdb
# 最初の列車を取得
(gdb) set $convoy = $karte->convoi_array._data[0].some_object

# 各メンバーのオフセットを計算
(gdb) print (char*)&($convoy->wait_lock) - (char*)$convoy
(gdb) print (char*)&($convoy->state) - (char*)$convoy
(gdb) print (char*)&($convoy->akt_speed) - (char*)$convoy
(gdb) print (char*)&($convoy->name_and_id) - (char*)$convoy
```

### Windows (x64dbg) の場合

#### ステップ1: x64dbg をダウンロード

https://x64dbg.com/ からダウンロードしてインストール

#### ステップ2: Simutransを起動

1. x64dbg.exe を起動
2. File → Open → simutrans.exe を選択
3. F9 を押して実行

#### ステップ3: 列車を作成

通常通りゲームで列車を作成します。

#### ステップ4: シンボルを検索

```
1. Symbols タブを開く
2. "karte_t" を検索
3. "convoi_array" のメンバーを見つける
4. アドレスを確認
```

#### ステップ5: メモリビューアーで確認

```
1. Memory Map タブでメモリ領域を確認
2. Dump ウィンドウで構造体の内容を確認
3. オフセットを計算
```

## 方法2: Simutrans OTRPコミュニティから入手

### GitHub で検索

```
1. https://github.com/teamhimeh/simutrans にアクセス
2. Issues や Discussions で "v50.1 offsets" を検索
3. もし誰かが共有していれば、そのファイルを使用
```

### フォーラムで質問

```
Simutrans日本フォーラムや国際フォーラムで質問:
"Does anyone have memory offsets for Simutrans OTRP v50.1 x64?"
```

## 方法3: ソースコードから推測（非推奨・不正確）

**警告**: この方法は不正確です。参考程度にしてください。

### karte_t の convoi_array オフセット

`simworld.h` を見ると:

```cpp
class karte_t {
private:
    settings_t settings;              // 大きなオブジェクト（サイズ不明）
    koord cached_grid_size;           // 8 bytes (x64)
    koord cached_size;                // 8 bytes
    int cached_size_max;              // 4 bytes
    tool_t *selected_tool[MAX_PLAYER_COUNT];  // 8*MAX_PLAYER_COUNT
    // ... 多くのメンバー ...
    array2d_tpl<uint8> climate_map;   // 可変サイズ
    array2d_tpl<uint8> humidity_map;  // 可変サイズ
    vector_tpl<convoihandle_t> convoi_array;  // ← これを探している
    // ...
};
```

`settings_t` や `array2d_tpl` のサイズが不明なため、正確な計算は不可能です。

**推測範囲**: x64ビルドでは通常 0x1000〜0x3000 の範囲ですが、**保証できません**。

### convoi_t のメンバーオフセット

`simconvoi.h` を見ると:

```cpp
class convoi_t : public sync_steppable, public overtaker_t {
    // 仮想テーブルポインタ: 16 bytes (2つの基底クラス)
    // overtaker_t のメンバー: 約8 bytes
    // → 合計約24 bytes のヘッダー

private:
    sint32 wait_lock;        // +0x18 (24 bytes後) ← 推測
    states state;            // +0x1C (28 bytes後) ← 推測
    // ...
    sint32 akt_speed;        // +0x?? (位置不明)
    // ...
    char name_and_id[128];   // +0x?? (位置不明)
};
```

これも**推測**です。実際のオフセットはコンパイラの最適化や配置により異なります。

## オフセット設定例（テンプレート）

`config/offsets.json` に以下のように設定:

```json
{
  "version": "50.1",
  "architecture": "x64",

  "offsets": {
    "karte_t": {
      "convoi_array": "0x1A80"  ← デバッガで見つけた値に置き換える
    },
    "convoi_t": {
      "wait_lock": "0x0018",    ← デバッガで見つけた値に置き換える
      "state": "0x001C",
      "akt_speed": "0x0090",
      "name_and_id": "0x0180"
    }
  }
}
```

**注意**: 上記の値は例です。実際の値はデバッガで確認してください！

## 動作確認方法

### 1. オフセットを設定

`config/offsets.json` を編集して値を設定

### 2. TiDツールを起動

```bash
# Linux
sudo python3 tid_main.py

# Windows (管理者権限で)
python tid_main.py
```

### 3. 結果を確認

#### 成功の場合:
```
✓ Attached to process (PID: 12345)
✓ Loaded offset configuration
✓ Starting HTTP server on 0.0.0.0:8080
Found 5 convoys
```

ブラウザで http://localhost:8080 にアクセスして、列車名が正しく表示されることを確認。

#### 失敗の場合:
```
Found 0 convoys  ← convoi_array のオフセットが間違っている
```

または

```
列車名が文字化け  ← convoi_t のオフセットが間違っている
```

この場合、オフセット値を修正して再試行してください。

## トラブルシューティング

### Q: デバッガでシンボルが見つからない

**原因**: Simutransがデバッグシンボルなしでコンパイルされている

**解決策**:
1. ソースコードから再コンパイル（`make DEBUG=1`）
2. または、メモリダンプから手動で構造体を探す（上級者向け）

### Q: オフセットが見つかったが、ツールが動かない

**原因**:
- アーキテクチャが間違っている（32bit vs 64bit）
- Simutransのバージョンが違う

**解決策**:
1. `file simutrans` コマンドでアーキテクチャを確認
2. Simutransのバージョンを確認（ゲーム内のヘルプ→バージョン情報）

### Q: 列車数は表示されるが、名前が文字化け

**原因**: `convoi_t.name_and_id` のオフセットが間違っている

**解決策**:
デバッガで `name_and_id` メンバーの正しいオフセットを見つける

## さらなるヘルプ

- **詳細ガイド**: `docs/offset_configuration.md` を参照
- **コミュニティ**: Simutrans フォーラムで質問
- **GitHub Issues**: https://github.com/teamhimeh/simutrans/issues

## まとめ

1. **デバッガを使用する**のが最も確実な方法です
2. コミュニティで既存の設定を探すのも有効です
3. ソースコードからの推測は不正確なので避けてください
4. 設定後は必ず動作確認を行ってください

正しいオフセット設定ができれば、TiDツールは完璧に動作します！
頑張ってください！

---

**作成日**: 2026-01-16
**対象バージョン**: Simutrans OTRP v50.1
**アーキテクチャ**: x64
