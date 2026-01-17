@echo off
REM Train Position Tracker - NSSM Service Installation Script
REM
REM このスクリプトは NSSM を使用して Train Tracker を Windows サービスとしてインストールします。
REM This script installs Train Tracker as a Windows service using NSSM.
REM
REM 前提条件:
REM Prerequisites:
REM - NSSM (Non-Sucking Service Manager) をダウンロードしてください
REM   Download NSSM from: https://nssm.cc/download
REM - このスクリプトを管理者権限で実行してください
REM   Run this script as Administrator

SETLOCAL

REM ========================================
REM Configuration
REM ========================================

REM サービス名
REM Service name
SET SERVICE_NAME=TrainTracker

REM NSSM 実行ファイルのパス
REM NSSM executable path
SET NSSM_EXE=nssm.exe

REM Python 実行ファイルのパス
REM Python executable path
SET PYTHON_EXE=C:\Python39\python.exe

REM サーバーディレクトリ
REM Server directory
SET SERVER_DIR=C:\train_tracker_server

REM サーバースクリプト
REM Server script
SET SERVER_SCRIPT=%SERVER_DIR%\server.py

REM JSONファイルのパス
REM JSON file path
SET JSON_PATH=C:\simutrans\train_positions.json

REM ========================================
REM Script Start
REM ========================================

echo =========================================
echo Train Tracker - Service Installation
echo =========================================
echo.

REM 管理者権限チェック
REM Check admin privileges
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo エラー: 管理者権限が必要です
    echo Error: Administrator privileges required
    echo このスクリプトを右クリックして「管理者として実行」を選択してください
    echo Right-click this script and select "Run as administrator"
    pause
    exit /b 1
)

REM NSSM の確認
REM Check NSSM
where %NSSM_EXE% >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo エラー: NSSM が見つかりません
    echo Error: NSSM not found
    echo.
    echo NSSM をダウンロードして PATH に追加するか、
    echo このスクリプトの NSSM_EXE 変数にフルパスを指定してください。
    echo.
    echo Download NSSM from: https://nssm.cc/download
    echo.
    pause
    exit /b 1
)

echo NSSM が見つかりました:
echo NSSM found:
where %NSSM_EXE%
echo.

REM 既存サービスの確認
REM Check existing service
sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo 警告: サービス '%SERVICE_NAME%' は既にインストールされています
    echo Warning: Service '%SERVICE_NAME%' is already installed
    echo 削除してから再インストールしますか？ (Y/N)
    echo Remove and reinstall? (Y/N)
    choice /c YN /n
    if %ERRORLEVEL% equ 1 (
        echo サービスを削除中...
        echo Removing service...
        %NSSM_EXE% stop %SERVICE_NAME%
        timeout /t 2 /nobreak >nul
        %NSSM_EXE% remove %SERVICE_NAME% confirm
        echo.
    ) else (
        echo インストールをキャンセルしました
        echo Installation cancelled
        pause
        exit /b 0
    )
)

REM サービスのインストール
REM Install service
echo =========================================
echo サービスをインストールしています...
echo Installing service...
echo =========================================
echo.

echo 1. サービスを作成...
echo 1. Creating service...
%NSSM_EXE% install %SERVICE_NAME% "%PYTHON_EXE%" "%SERVER_SCRIPT%"
if %ERRORLEVEL% neq 0 (
    echo エラー: サービスの作成に失敗しました
    echo Error: Failed to create service
    pause
    exit /b 1
)

echo 2. 作業ディレクトリを設定...
echo 2. Setting working directory...
%NSSM_EXE% set %SERVICE_NAME% AppDirectory "%SERVER_DIR%"

echo 3. 環境変数を設定...
echo 3. Setting environment variables...
%NSSM_EXE% set %SERVICE_NAME% AppEnvironmentExtra "JSON_PATH=%JSON_PATH%"

echo 4. 説明を設定...
echo 4. Setting description...
%NSSM_EXE% set %SERVICE_NAME% Description "Simutrans OTRP Train Position Tracker Web Server"

echo 5. スタートアップタイプを設定...
echo 5. Setting startup type...
%NSSM_EXE% set %SERVICE_NAME% Start SERVICE_AUTO_START

echo 6. ログ設定...
echo 6. Configuring logging...
%NSSM_EXE% set %SERVICE_NAME% AppStdout "%SERVER_DIR%\logs\stdout.log"
%NSSM_EXE% set %SERVICE_NAME% AppStderr "%SERVER_DIR%\logs\stderr.log"

REM ログディレクトリ作成
REM Create log directory
if not exist "%SERVER_DIR%\logs" mkdir "%SERVER_DIR%\logs"

echo.
echo =========================================
echo サービスのインストールが完了しました
echo Service installation completed
echo =========================================
echo.
echo サービス名: %SERVICE_NAME%
echo Service name: %SERVICE_NAME%
echo.
echo サービスを開始しますか？ (Y/N)
echo Start the service now? (Y/N)
choice /c YN /n
if %ERRORLEVEL% equ 1 (
    echo.
    echo サービスを開始しています...
    echo Starting service...
    %NSSM_EXE% start %SERVICE_NAME%
    echo.
    timeout /t 3 /nobreak >nul
    sc query %SERVICE_NAME%
    echo.
    echo サービスが開始されました
    echo Service started
    echo ブラウザで http://localhost:5000 にアクセスしてください
    echo Access http://localhost:5000 in your browser
) else (
    echo.
    echo サービスを手動で開始するには:
    echo To start the service manually:
    echo   sc start %SERVICE_NAME%
    echo または
    echo or
    echo   %NSSM_EXE% start %SERVICE_NAME%
)

echo.
echo =========================================
echo サービス管理コマンド:
echo Service management commands:
echo =========================================
echo 開始: %NSSM_EXE% start %SERVICE_NAME%
echo Start: sc start %SERVICE_NAME%
echo.
echo 停止: %NSSM_EXE% stop %SERVICE_NAME%
echo Stop: sc stop %SERVICE_NAME%
echo.
echo 再起動: %NSSM_EXE% restart %SERVICE_NAME%
echo Restart: sc stop %SERVICE_NAME% ^&^& sc start %SERVICE_NAME%
echo.
echo 削除: %NSSM_EXE% remove %SERVICE_NAME% confirm
echo Remove: sc delete %SERVICE_NAME%
echo =========================================

pause
