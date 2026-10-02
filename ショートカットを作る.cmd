@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\create-shortcut.ps1"
echo.
echo  デスクトップとスタートメニューに「TAISA Mirror」を作りました。
echo  ピン留め: スタートメニュー - すべて - TAISA Mirror を右クリック - スタートにピン留めする / その他 - タスクバーにピン留めする
echo.
pause
