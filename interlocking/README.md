# TID 連動盤（外部信号制御盤）— 試作 P0

外部の盤（Web 盤・物理盤など）から、駅の信号と進路（番線の選択）を扱うための機能。
設計は `documentation/interlocking_panel_design_ja.md` を参照。

| ファイル | 内容 |
|---|---|
| `interlocking.h` | 本体から呼ぶフック関数の宣言。`TID_INTERLOCKING` の定義 |
| `il_hooks.cc` | フック関数の実装（薄い中継） |
| `il_manager.*` | 連動装置本体（連動駅・てこ扱い信号・進路・判定・自動解除・セーブ） |
| `il_tool.*` | `TOOL_INTERLOCKING`（盤の操作をネットワーク同期するツール） |
| `il_bridge.*` | 外部の盤とつなぐ TCP 窓口（127.0.0.1 のみ） |
| `PROTOCOL.md` | 盤との通信の仕様 |
| `PORTING.md` | 新しい OTRP への移植手順 |
| `hooks.patch` / `check_hooks.sh` | 移植用のパッチと確認スクリプト |
| `tests/` | ヘッドレスで動かす自動テスト（シナリオ `il-test` ＋ `run_test.py`） |
| `tools/il_cli.py` | 手で試すための簡易コンソール盤 |

## 試し方

1. ユーザーディレクトリに `interlocking.tab` を作り、`port=13360` と書く（または環境変数 `TID_IL_PORT=13360`）。
2. ゲームを起動してマップを開く。
3. `python3 interlocking/tools/il_cli.py` で接続し、`PROTOCOL.md` のコマンドを打つ。

例（S1 = (3,5,0) の信号、1 番線の端 = (8,5,0)、2 番線の端 = (8,6,0) の場合）:

```
cmd st_new,A駅
cmd sig_add,1,3,5,0
cmd rt_def,1,3,5,0,8,5,0,S1→1番線
cmd rt_def,1,3,5,0,8,6,0,S1→2番線
cmd st_mode,1,1        ← 扱者モードにすると、S1 は進路を引くまで停止を示す
cmd set,3              ← 「S1→2番線」を引く。列車が来ると進行を示し、2 番線に入る
status
```

## 試作版の制約

- 連動区域の入口はすべててこ扱い信号にすること（区域内に自動信号の列車が入り込むのを防ぐ仕組みは入れていない）。
- 進路の途中に、てこ扱いでない信号を置かないこと。
- 車庫・側線などの抜け道の検査、区域の自動取り込み、Web 盤は未実装（P1〜P3）。
- 接近鎖錠（時素）はない。列車が進入する前なら、いつでも進路を戻せる。
