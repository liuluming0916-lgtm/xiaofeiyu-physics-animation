@echo off
cd /d "%~dp0"
chcp 65001 >nul
setlocal

echo ============================================================
echo   History Ledger - SAMPLE (not your real ledger)
echo   Sample file: _preview-history\sample.db
echo ============================================================
echo.

set "NODE_EXE=C:\Users\Liu LuMing\AppData\Local\OpenDesign\toolchains\dsh\node-v24.19.0-win-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" tools\_history-view.mjs --sample
echo.
echo ------------------------------------------------------------
echo   Press any key to close this window.
pause >nul
endlocal
