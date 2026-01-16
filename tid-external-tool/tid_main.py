#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simutrans Train Information Display (TiD) - External Tool
Main entry point
"""

import sys
import argparse
import json
from memory_scanner import MemoryReader, ConvoyExtractor
from tid_server import run_server


def load_config(config_file="config/tid_config.json"):
    """Load TiD configuration"""
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: Configuration file not found: {config_file}")
        print(f"Using default settings...")
        return {
            "server": {"host": "0.0.0.0", "port": 8080},
            "scanner": {"process_name": "simutrans.exe", "update_interval_seconds": 4},
            "offsets_file": "config/offsets.json"
        }
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in configuration file: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description='Simutrans TiD External Tool - Train Information Display',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  python tid_main.py                     # デフォルト設定で起動
  python tid_main.py --port 9000         # ポート9000で起動
  python tid_main.py --process simutrans # Linuxでプロセス名指定
        """
    )

    parser.add_argument('--process', help='Simutransプロセス名（デフォルト: simutrans.exe）')
    parser.add_argument('--port', type=int, help='HTTPサーバーポート（デフォルト: 8080）')
    parser.add_argument('--host', help='HTTPサーバーバインドアドレス（デフォルト: 0.0.0.0）')
    parser.add_argument('--interval', type=int, help='メモリスキャン間隔（秒）（デフォルト: 4）')
    parser.add_argument('--config', default='config/tid_config.json', help='設定ファイルパス')
    parser.add_argument('--offsets', help='オフセット設定ファイルパス')

    args = parser.parse_args()

    print()
    print("=" * 60)
    print("  Simutrans Train Information Display (TiD)")
    print("  列車在線表示システム - 外部ツール版")
    print("=" * 60)
    print()

    # Load configuration
    config = load_config(args.config)

    # Override with command line arguments
    process_name = args.process or config['scanner'].get('process_name', 'simutrans.exe')
    host = args.host or config['server'].get('host', '0.0.0.0')
    port = args.port or config['server'].get('port', 8080)
    interval = args.interval or config['scanner'].get('update_interval_seconds', 4)
    offsets_file = args.offsets or config.get('offsets_file', 'config/offsets.json')

    print(f"  プロセス名:       {process_name}")
    print(f"  サーバーアドレス: {host}:{port}")
    print(f"  更新間隔:         {interval}秒")
    print(f"  オフセット設定:   {offsets_file}")
    print()

    try:
        # Attach to Simutrans process
        print("Simutransプロセスに接続中...")
        mem_reader = MemoryReader(process_name)

        # Load offset configuration
        scanner = ConvoyExtractor(mem_reader)
        if not scanner.load_offsets(offsets_file):
            print()
            print("=" * 60)
            print("  警告: オフセット設定が見つかりません")
            print("=" * 60)
            print()
            print("オフセット設定を作成してください:")
            print("  1. python offset_discovery.py を実行")
            print("  2. config/offsets.json を編集")
            print()
            print("詳細は docs/offset_configuration.md を参照してください")
            print()
            sys.exit(1)

        # Start HTTP server
        run_server(scanner, host=host, port=port, update_interval=interval)

    except RuntimeError as e:
        print()
        print(f"✗ エラー: {e}")
        print()
        print("トラブルシューティング:")
        print("  1. Simutransが起動しているか確認")
        print("  2. プロセス名が正しいか確認")

        if sys.platform != 'win32':
            print("  3. root権限で実行: sudo python3 tid_main.py")
        else:
            print("  3. 管理者権限で実行")

        print()
        sys.exit(1)

    except KeyboardInterrupt:
        print("\n\n✓ 終了しました")
        sys.exit(0)

    except Exception as e:
        print(f"\n✗ 予期しないエラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
