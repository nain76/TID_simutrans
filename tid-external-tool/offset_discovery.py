#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simutrans TiD - Offset Discovery Tool
Interactive tool to help users find memory offsets for their Simutrans version
"""

import sys
import json
import platform

print("=" * 60)
print("  Simutrans TiD - Offset Discovery Tool")
print("=" * 60)
print()

print("このツールは、お使いのSimutransバージョンに合わせた")
print("メモリオフセットを自動的に検出します。")
print()

print("注意: このツールは現在開発中です。")
print()
print("手動でオフセットを設定する必要があります:")
print()
print("1. Simutransのソースコードを参照")
print("2. デバッガ（gdb/x64dbg）を使用")
print("3. コミュニティで共有されたオフセット設定をダウンロード")
print()

print("=" * 60)
print("  設定ファイル生成")
print("=" * 60)
print()

# デフォルトのオフセット設定を生成
default_offsets = {
    "comment": "Memory offsets for Simutrans OTRP - MUST be configured manually",
    "version": "UNKNOWN - Please update",
    "architecture": "x64" if platform.machine().endswith('64') else "x86",
    "instructions": "These are placeholder values. You must find the correct offsets for your Simutrans version.",

    "offsets": {
        "karte_t": {
            "convoi_array": "0x0000",
            "halt_array": "0x0000",
            "comment": "Offset of convoi_array and halt_array in karte_t (world) object"
        },
        "convoi_t": {
            "id": "0x0000",
            "name": "0x0000",
            "position": "0x0000",
            "speed": "0x0000",
            "state": "0x0000",
            "schedule": "0x0000",
            "vehicles": "0x0000",
            "comment": "Offsets within convoi_t object"
        },
        "vehicle_t": {
            "cargo_max": "0x0000",
            "cargo_loaded": "0x0000",
            "comment": "Offsets within vehicle_t object"
        },
        "haltestelle_t": {
            "name": "0x0000",
            "position": "0x0000",
            "comment": "Offsets within haltestelle_t (station) object"
        }
    }
}

output_file = "config/offsets.json"

try:
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(default_offsets, f, indent=2, ensure_ascii=False)

    print(f"✓ テンプレート設定ファイルを作成しました: {output_file}")
    print()
    print("次のステップ:")
    print("1. config/offsets.json を編集")
    print("2. 正しいメモリオフセット値を入力")
    print("3. python tid_main.py を実行")
    print()
    print("オフセットの見つけ方については docs/offset_configuration.md を参照してください")
    print()

except Exception as e:
    print(f"✗ エラー: {e}")
    sys.exit(1)

print("=" * 60)
print()
print("将来のバージョンでは、自動検出機能を実装予定です。")
print("現在は手動設定が必要ですが、コミュニティで共有された")
print("オフセット設定を利用することもできます。")
print()
