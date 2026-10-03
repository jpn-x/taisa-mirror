@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title TAISA Mirror
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
rem Normal quit or "already running" (exit code 0): close this window by itself.
rem Only stay open (pause) if something went wrong, so the message can be read.
if errorlevel 1 (
  echo.
  echo  TAISA Mirror stopped with an error. Details: data\taisa-mirror.log
  echo.
  pause
)
