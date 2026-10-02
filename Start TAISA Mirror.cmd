@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title TAISA Mirror (このウィンドウを閉じると終了します)
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  Node.js が見つかりません。次のどちらかを行ってください:
    echo    1. 配布ZIP版を使う（runtime\node.exe が同梱されています）
    echo    2. Windows の「ターミナル」で  winget install OpenJS.NodeJS.LTS  を実行
    echo.
    pause
    exit /b 1
  )
  set "NODE=node"
)
echo  TAISA Mirror を起動しています...
"%NODE%" server\index.js --open
echo.
echo  TAISA Mirror が終了しました。
pause
