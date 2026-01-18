#!/usr/bin/env python3
"""
Train Position Tracker Web Server

Flask-based web server that serves train position data from Simutrans OTRP.
Supports Basic authentication and external access.
"""

from flask import Flask, jsonify, send_from_directory, request, Response
from functools import wraps
import json
import os
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Configuration from environment variables
JSON_PATH = os.environ.get('JSON_PATH', str(Path.cwd() / 'train_positions.json'))
STATION_JSON_PATH = os.environ.get('STATION_JSON_PATH', str(Path.cwd() / 'station_data.json'))
USERNAME = os.environ.get('AUTH_USERNAME', 'admin')
PASSWORD = os.environ.get('AUTH_PASSWORD', 'changeme')
PORT = int(os.environ.get('PORT', 5000))
DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'

print(f"[Train Tracker Server] Starting...")
print(f"[Train Tracker Server] JSON Path: {JSON_PATH}")
print(f"[Train Tracker Server] Station JSON Path: {STATION_JSON_PATH}")
print(f"[Train Tracker Server] Port: {PORT}")
print(f"[Train Tracker Server] Debug: {DEBUG}")


def check_auth(username, password):
    """
    Check if username and password are valid

    Args:
        username: Username to check
        password: Password to check

    Returns:
        True if valid, False otherwise
    """
    return username == USERNAME and password == PASSWORD


def authenticate():
    """
    Send 401 response that enables basic auth

    Returns:
        Flask Response with 401 status
    """
    return Response(
        'ログインが必要です\nAuthentication required',
        401,
        {'WWW-Authenticate': 'Basic realm="Train Tracker"'}
    )


def requires_auth(f):
    """
    Decorator for routes that require authentication

    Args:
        f: Function to wrap

    Returns:
        Decorated function
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.authorization
        if not auth or not check_auth(auth.username, auth.password):
            return authenticate()
        return f(*args, **kwargs)
    return decorated


@app.route('/')
@requires_auth
def index():
    """
    Serve the main HTML page (table view)

    Returns:
        HTML file
    """
    return send_from_directory('static', 'index.html')


@app.route('/diagram')
@requires_auth
def diagram():
    """
    Serve the diagram HTML page (visual railroad diagram)

    Returns:
        HTML file
    """
    return send_from_directory('static', 'diagram.html')


@app.route('/static/<path:filename>')
@requires_auth
def serve_static(filename):
    """
    Serve static files (CSS, JS, etc.)

    Args:
        filename: File to serve

    Returns:
        Static file
    """
    return send_from_directory('static', filename)


@app.route('/api/trains')
@requires_auth
def get_trains():
    """
    Get all train positions from JSON file

    Returns:
        JSON response with train data
    """
    try:
        if os.path.exists(JSON_PATH):
            with open(JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify(data)
        else:
            return jsonify({
                "timestamp": datetime.now().isoformat(),
                "trains": [],
                "error": "Data file not found. Is Simutrans running with the scenario loaded?"
            })
    except json.JSONDecodeError as e:
        return jsonify({
            "timestamp": datetime.now().isoformat(),
            "trains": [],
            "error": f"Invalid JSON format: {str(e)}"
        }), 500
    except Exception as e:
        return jsonify({
            "timestamp": datetime.now().isoformat(),
            "trains": [],
            "error": f"Error reading data: {str(e)}"
        }), 500


@app.route('/api/lines')
@requires_auth
def get_lines():
    """
    Get list of all unique lines from train data

    Returns:
        JSON response with line names
    """
    try:
        if os.path.exists(JSON_PATH):
            with open(JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Extract unique line names
            lines = sorted(set(
                train.get('line', '無所属')
                for train in data.get('trains', [])
            ))

            return jsonify({"lines": lines})
        else:
            return jsonify({"lines": []})
    except Exception as e:
        return jsonify({"lines": [], "error": str(e)}), 500


@app.route('/api/stations')
@requires_auth
def get_stations():
    """
    Get station data for all lines

    Returns:
        JSON response with station data organized by line
    """
    try:
        if os.path.exists(STATION_JSON_PATH):
            with open(STATION_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify(data)
        else:
            return jsonify({
                "timestamp": datetime.now().isoformat(),
                "lines": [],
                "error": "Station data file not found. Waiting for yearly export or manual trigger."
            })
    except json.JSONDecodeError as e:
        return jsonify({
            "timestamp": datetime.now().isoformat(),
            "lines": [],
            "error": f"Invalid JSON format: {str(e)}"
        }), 500
    except Exception as e:
        return jsonify({
            "timestamp": datetime.now().isoformat(),
            "lines": [],
            "error": f"Error reading station data: {str(e)}"
        }), 500


@app.route('/api/line-config')
@requires_auth
def get_line_config():
    """
    Get manual line configuration for custom station positioning (optional)

    Returns:
        JSON response with manual station positions or 404 if not configured
    """
    config_path = Path(JSON_PATH).parent / 'line_config.json'

    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify(data)
        else:
            return jsonify({}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/health')
def health():
    """
    Health check endpoint (no authentication required)

    Returns:
        JSON response with server status
    """
    file_exists = os.path.exists(JSON_PATH)
    file_age = None
    file_size = None

    if file_exists:
        stat = os.stat(JSON_PATH)
        file_age = datetime.now().timestamp() - stat.st_mtime
        file_size = stat.st_size

    return jsonify({
        "status": "ok",
        "data_file_exists": file_exists,
        "data_file_path": JSON_PATH,
        "data_file_age_seconds": file_age,
        "data_file_size_bytes": file_size,
        "server_time": datetime.now().isoformat()
    })


@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    """Handle 500 errors"""
    return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    # Run server
    # host='0.0.0.0' allows external access
    # Set debug=False for production
    app.run(
        host='0.0.0.0',
        port=PORT,
        debug=DEBUG,
        threaded=True
    )
