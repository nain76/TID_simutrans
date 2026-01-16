# シンボルなしでオフセットを見つける方法（Simutrans OTRP v50.1）

## 問題: x64dbgでシンボルが見つからない

Simutransが**デバッグシンボルなし**でコンパイルされている場合、`karte_t`や`convoi_t`などのシンボルは表示されません。

この場合、**Cheat Engine**を使ってメモリパターンから構造体を探します。

---

## 方法: Cheat Engine を使用

### ステップ1: Cheat Engine のインストール

1. https://www.cheatengine.org/ からダウンロード
2. インストール（広告ウェアに注意、カスタムインストールを選択）

### ステップ2: Simutrans に接続

1. Simutrans OTRP v50.1 を起動
2. ゲームで**列車を1台作成**して名前をつける（例：「TEST001」）
3. Cheat Engine を起動
4. 左上のPCアイコンをクリック → `simutrans.exe` を選択

### ステップ3: 列車名を検索

#### 3-1. 文字列検索

```
1. Value Type: "String" を選択
2. 検索ボックスに列車名を入力（例: "TEST001"）
3. "First Scan" をクリック
```

複数の結果が見つかります。

#### 3-2. 列車の速度を検索（並行して）

```
1. 新しいスキャンウィンドウを開く
2. Value Type: "4 Bytes" を選択
3. Scan Type: "Unknown initial value"
4. "First Scan" をクリック
5. ゲーム内で列車を少し動かす
6. Scan Type: "Increased value" でスキャン
7. 列車を止める
8. Scan Type: "Unchanged value" でスキャン
9. 繰り返して候補を絞る
```

### ステップ4: 構造体の探索

#### convoi_t 構造体のパターン

simconvoi.h から、convoi_t の構造を見ると：

```cpp
class convoi_t {
    // +0x00: vtable pointer (8 bytes on x64)
    // +0x08: vtable pointer from overtaker_t (8 bytes)
    // +0x10: overtaker_t data (~8 bytes)
    // +0x18: sint32 wait_lock (4 bytes)
    // +0x1C: states state (4 bytes enum)
    // ...
    // +0x???: sint32 akt_speed (current speed)
    // ...
    // +0x???: char name_and_id[128]
};
```

#### メモリビューアで確認

```
1. Cheat Engine で見つけた列車名のアドレスを右クリック
2. "Browse this memory region" を選択
3. メモリダンプが表示される
4. 列車名の**前方**を見る
   - 128バイトアライメントに注目
   - 列車名の開始位置を確認
```

例:
```
Address          Hex Values                           ASCII
0x12345600:  00 00 00 00 04 00 00 00 ...         ........
0x12345680:  54 45 53 54 30 30 31 00 ...         TEST001.
             ↑
             これが name_and_id の開始アドレス
```

列車名が `0x12345680` から始まる場合、convoi_t オブジェクトの開始は `0x12345680 - offset_of_name_and_id` です。

### ステップ5: オフセットの計算

#### name_and_id のオフセット推定

simconvoi.h を見ると、`name_and_id[128]` はクラスの後半にあります。

典型的な x64 ビルドでは：
- `name_and_id` のオフセットは **0x180〜0x200** 程度

試しに:
```
convoi_t オブジェクト開始 = 列車名アドレス - 0x180
```

#### speed のオフセット推定

`akt_speed` は `name_and_id` より前にあります。

メモリビューアで列車名の前方を見て、**変化する4バイト値**を探します：

```
1. Memory Viewer で列車名の-0x200バイト付近を表示
2. ゲーム内で列車を加速/減速
3. 値が変化する箇所を探す（sint32なので4バイト値）
```

見つけたら、その位置が `akt_speed` のオフセットです。

### ステップ6: karte_t の convoi_array を探す

#### 方法1: ポインタスキャン

```
1. Cheat Engine で見つけた convoi_t オブジェクトのアドレスをコピー
2. 新しいスキャン: Value Type "8 Bytes" (ポインタ)
3. そのアドレス値を検索
4. 見つかったアドレスが convoi_array の要素を指すポインタ
```

#### 方法2: 複数列車で確認

```
1. ゲーム内で列車を2台作成（TEST001, TEST002）
2. 両方の convoi_t アドレスを見つける
3. メモリ内で連続して格納されている場所を探す
   → これが convoi_array
```

---

## 実践例

### 例: TEST001 という列車で調査

#### 1. 列車名を検索

```
Cheat Engine → String search → "TEST001"
結果: 0x12345680 で見つかった
```

#### 2. convoi_t の開始アドレスを推定

```
simconvoi.h から name_and_id のオフセットは ~0x180 と推測
convoi_t 開始 = 0x12345680 - 0x180 = 0x12345500
```

#### 3. メモリビューアで確認

```
0x12345500 付近を見る:
0x12345500:  A0 B0 C0 D0 ...  ← vtable pointer
0x12345508:  E0 F0 00 10 ...  ← vtable pointer
0x12345510:  ...
0x12345518:  00 00 00 00      ← wait_lock (0)
0x1234551C:  06 00 00 00      ← state (6 = DRIVING)
...
```

#### 4. akt_speed を探す

```
列車を動かしながらメモリを監視
0x12345590 の値が変化 → これが akt_speed
offset = 0x12345590 - 0x12345500 = 0x90
```

#### 5. offsets.json に記録

```json
{
  "version": "50.1",
  "architecture": "x64",
  "offsets": {
    "convoi_t": {
      "wait_lock": "0x0018",
      "state": "0x001C",
      "akt_speed": "0x0090",
      "name_and_id": "0x0180"
    }
  }
}
```

---

## 簡易版: 最小限のオフセットだけ見つける

TiDツールを動かすには、最低限これだけあればOK：

### 必須オフセット

1. **karte_t::convoi_array** - 列車リストの位置
2. **convoi_t::name_and_id** - 列車名の位置
3. **convoi_t::akt_speed** - 速度の位置（オプション）

### 超簡易手順

```
1. Cheat Engine で列車名 "TEST001" を検索
2. 見つかったアドレスをメモ: 0xXXXXXX80
3. このアドレス - 0x180 = convoi_t の開始アドレス（推測）
4. offsets.json に設定:
   {
     "convoi_t": {
       "name_and_id": "0x0180"
     }
   }
5. TiDツールを起動してテスト
6. 動かなかったら 0x180 を 0x170, 0x190 などに変えて試す
```

---

## トラブルシューティング

### Q: 列車名が複数見つかる

**原因**: UIやログにも同じ文字列が存在

**解決**:
- 各アドレスをメモリビューアで確認
- 128バイト境界に配置されているものが正解の可能性が高い

### Q: 速度が見つからない

**原因**: sint32 (符号付き整数) で格納されている

**解決**:
- 速度が0の時を基準にする
- Value Type を "4 Bytes" にして Unknown Value スキャン
- 列車を動かして Changed Value でフィルタ

### Q: オフセットを設定してもツールが動かない

**原因**: convoi_array のオフセットが間違っている

**解決**:
1. まず convoi_t のオフセットだけ正確に設定
2. convoi_array は後で探す
3. または、2台目の列車を作って配列を探す

---

## まとめ

シンボルなしでも、以下の手順でオフセットを見つけられます：

1. **Cheat Engine で列車名を検索**
2. **メモリビューアで構造体を確認**
3. **変化する値（速度など）を追跡**
4. **オフセットを計算して記録**
5. **TiDツールでテスト**

時間はかかりますが、この方法なら確実にオフセットを見つけられます。

頑張ってください！

---

**最終更新**: 2026-01-16
**対象バージョン**: Simutrans OTRP v50.1 (シンボルなし)
**推奨ツール**: Cheat Engine 7.5+
