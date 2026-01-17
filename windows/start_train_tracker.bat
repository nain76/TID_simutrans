@echo off
REM Train Position Tracker - Start Script for Windows
REM
REM このバッチファイルを実行すると、Train Tracker Webサーバーが起動します。
REM Run this batch file to start the Train Tracker Web Server.

SETLOCAL

REM ========================================
REM Configuration
REM ========================================

REM Webサーバーのディレクトリ
REM Server directory
SET SERVER_DIR=C:\train_tracker_server

REM Pythonの実行ファイル（環境に合わせて変更してください）
REM Python executable path (change according to your environment)
SET PYTHON_EXE=python

REM ========================================
REM Script Start
REM ========================================

echo =========================================
echo Train Position Tracker - Web Server
echo =========================================
echo.

REM ディレクトリの存在確認
REM Check if directory exists
if not exist "%SERVER_DIR%" (
    echo エラー: サーバーディレクトリが見つかりません
    echo Error: Server directory not found: %SERVER_DIR%
    echo.
    pause
    exit /b 1
)

REM ディレクトリに移動
REM Change to server directory
cd /d "%SERVER_DIR%"
echo サーバーディレクトリ: %CD%
echo Server directory: %CD%
echo.

REM .envファイルの確認
REM Check .env file
if not exist ".env" (
    echo 警告: .env ファイルが見つかりません
    echo Warning: .env file not found
    echo .env.example をコピーして .env を作成してください
    echo Copy .env.example to .env and configure it
    echo.
    pause
    exit /b 1
)

REM Pythonのバージョン確認
REM Check Python version
echo Pythonのバージョンを確認中...
echo Checking Python version...
%PYTHON_EXE% --version
if %ERRORLEVEL% neq 0 (
    echo エラー: Pythonが見つかりません
    echo Error: Python not found
    echo Pythonをインストールしてください: https://www.python.org/downloads/
    echo Install Python from: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)
echo.

REM 依存関係の確認
REM Check dependencies
echo 依存パッケージを確認中...
echo Checking dependencies...
%PYTHON_EXE% -c "import flask" 2>nul
if %ERRORLEVEL% neq 0 (
    echo 警告: Flask がインストールされていません
    echo Warning: Flask is not installed
    echo 依存パッケージをインストールしますか？ (Y/N)
    echo Install dependencies? (Y/N)
    choice /c YN /n
    if %ERRORLEVEL% equ 1 (
        echo インストール中...
        echo Installing...
        %PYTHON_EXE% -m pip install -r requirements.txt
    ) else (
        echo スキップしました
        echo Skipped
    )
)
echo.

REM サーバー起動
REM Start server
echo =========================================
echo サーバーを起動しています...
echo Starting server...
echo =========================================
echo.
echo サーバーが起動したら、ブラウザで以下のURLにアクセスしてください：
echo When server is ready, access the following URL in your browser:
echo   http://localhost:5000
echo.
echo サーバーを停止するには Ctrl+C を押してください
echo Press Ctrl+C to stop the server
echo =========================================
echo.

REM Pythonスクリプトを実行
REM Run Python script
%PYTHON_EXE% server.py

REM エラーチェック
REM Error check
if %ERRORLEVEL% neq 0 (
    echo.
    echo =========================================
    echo エラー: サーバーが正常に終了しませんでした
    echo Error: Server did not exit normally
    echo エラーコード: %ERRORLEVEL%
    echo Error code: %ERRORLEVEL%
    echo =========================================
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo サーバーが停止しました
echo Server stopped
pause
