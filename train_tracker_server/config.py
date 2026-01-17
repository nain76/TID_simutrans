"""
Configuration module for Train Tracker Server

This module provides default configuration values.
Values can be overridden by environment variables.
"""

import os
from pathlib import Path

class Config:
    """Base configuration"""

    # Flask settings
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'

    # Server settings
    HOST = os.environ.get('HOST', '0.0.0.0')
    PORT = int(os.environ.get('PORT', 5000))

    # Authentication
    AUTH_USERNAME = os.environ.get('AUTH_USERNAME', 'admin')
    AUTH_PASSWORD = os.environ.get('AUTH_PASSWORD', 'changeme')

    # Data file path
    JSON_PATH = os.environ.get(
        'JSON_PATH',
        str(Path.cwd() / 'train_positions.json')
    )

    # Update interval (client-side polling in milliseconds)
    UPDATE_INTERVAL_MS = int(os.environ.get('UPDATE_INTERVAL_MS', 5000))


class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True


class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False


# Configuration dictionary
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}
