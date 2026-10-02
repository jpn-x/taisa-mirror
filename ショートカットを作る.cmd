@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\create-shortcut.ps1"
echo.
echo  デスクトップとスタートメニューに「TAISA Mirror」を作りました。
echo  ピン留め: ショートカットを右クリック - その他のオプションを確認 - スタートにピン留めする / タスクバーにピン留めする
echo.
pause
