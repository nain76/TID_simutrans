#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simutrans TiD - HTTP Server
Flask server that provides JSON API and serves Web UI
"""

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import threading
import time
import os

app = Flask(__name__, static_folder='web')
CORS(app)  # Enable CORS for external access

# Global data store (updated by scanner thread)
convoy_data = []
station_data = []
last_update = 0
scanner_running = False


class DataUpdater(threading.Thread):
    """Background thread to scan memory every few seconds"""

    def __init__(self, scanner, interval=4):
        super().__init__(daemon=True)
        self.scanner = scanner
        self.interval = interval
        self.running = True

    def run(self):
        global convoy_data, station_data, last_update, scanner_running

        print(f"✓ Starting memory scanner (update interval: {self.interval}s)")
        scanner_running = True

        while self.running:
            try:
                # Extract data from game memory
                convoy_data = self.scanner.get_all_convoys()
                station_data = self.scanner.get_all_stations()
                last_update = time.time()

                if convoy_data:
                    print(f"  Scanned: {len(convoy_data)} convoys, {len(station_data)} stations")

            except Exception as e:
                print(f"  Warning: Error scanning memory: {e}")

            # Wait before next update
            time.sleep(self.interval)

    def stop(self):
        self.running = False
        global scanner_running
        scanner_running = False


# API Endpoints

@app.route('/api/trains')
def get_trains():
    """Return all train data as JSON"""
    return jsonify({
        'timestamp': last_update,
        'scanner_running': scanner_running,
        'trains': [
            {
                'id': c.id,
                'name': c.name,
                'schedule_name': c.schedule_name if c.schedule_name else f"スケジュール{c.id}",
                'position': {'x': c.position.x, 'y': c.position.y, 'z': c.position.z},
                'speed': c.speed,
                'state': c.state,
                'capacity': c.capacity,
                'load': c.load,
                'occupancy_percent': c.occupancy_percent,
                'next_stop': c.next_stop_name
            }
            for c in convoy_data
        ]
    })


@app.route('/api/config')
def get_config():
    """Return station/track configuration (auto-generated horizontal layout)"""
    stations = []
    x_pos = 100
    y_pos = 300

    for station in station_data:
        stations.append({
            'name': station.name,
            'game_pos': {'x': station.position.x, 'y': station.position.y, 'z': station.position.z},
            'display_pos': {'x': x_pos, 'y': y_pos}
        })
        x_pos += 150  # Horizontal spacing

    # If no stations, create a default layout based on train positions
    if not stations and convoy_data:
        # Create virtual stations from train positions
        train_positions = {}
        for convoy in convoy_data:
            pos_key = f"{convoy.position.x},{convoy.position.y}"
            if pos_key not in train_positions:
                train_positions[pos_key] = convoy.position
                stations.append({
                    'name': f"Position ({convoy.position.x}, {convoy.position.y})",
                    'game_pos': {'x': convoy.position.x, 'y': convoy.position.y, 'z': convoy.position.z},
                    'display_pos': {'x': x_pos, 'y': y_pos}
                })
                x_pos += 150

    return jsonify({
        'auto_generated': True,
        'sections': [{
            'id': 'auto_section_1',
            'name': 'All Tracks',
            'stations': stations
        }]
    })


@app.route('/api/status')
def get_status():
    """Return server status"""
    return jsonify({
        'running': scanner_running,
        'last_update': last_update,
        'convoy_count': len(convoy_data),
        'station_count': len(station_data)
    })


@app.route('/')
def index():
    """Serve the main HTML page"""
    return send_from_directory('web', 'index.html')


@app.route('/<path:path>')
def static_files(path):
    """Serve static files (CSS, JS)"""
    try:
        return send_from_directory('web', path)
    except:
        return "File not found", 404


def run_server(scanner, host='0.0.0.0', port=8080, update_interval=4):
    """Start the HTTP server with background memory scanner"""

    # Start background updater thread
    updater = DataUpdater(scanner, interval=update_interval)
    updater.start()

    print()
    print("=" * 60)
    print(f"  TiD Server starting on http://{host}:{port}")
    print("=" * 60)
    print()
    print(f"  ローカルアクセス:     http://localhost:{port}")

    if host == '0.0.0.0':
        print(f"  外部PCからアクセス:   http://[サーバーIP]:{port}")
        print()
        print(f"  ※ファイアウォールでポート{port}を開放してください")

    print()
    print("  Ctrl+C で停止")
    print("=" * 60)
    print()

    try:
        # Run Flask server
        app.run(host=host, port=port, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        print("\n\n✓ Server stopped")
        updater.stop()
    except Exception as e:
        print(f"\n✗ Server error: {e}")
        updater.stop()
