@echo off
cd /d "%~dp0"
setlocal

rem 可选参数：端口（默认 8080）。端口被占时，用 3-OpenRules.bat 8081
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8080"

echo ============================================================
echo   Physics Animation - Rules Studio
echo   (edit prompts / cleaning rules / endpoints + keys)
echo ============================================================
echo.
echo   1. A browser will open at http://127.0.0.1:%PORT%/
echo   2. Open the "Rules" tab in the top bar.
echo   3. DO NOT close this black window while you edit:
echo      closing it stops the page from saving anything.
echo   4. Every save writes real files under ai-rules\
echo      (atomic write + hash check; a broken file is refused).
echo.
echo   NOTE: http://127.0.0.1:%PORT%/ is served by THIS window.
echo         If 2-OpenUI.bat is already running, close it first
echo         (both want port %PORT%), or run: 3-OpenRules.bat 8081
echo.

set "NODE_EXE=C:\Users\Liu LuMing\AppData\Local\OpenDesign\toolchains\dsh\node-v24.19.0-win-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

start "" http://127.0.0.1:%PORT%/

echo ------------------------------------------------------------
"%NODE_EXE%" tools\rules-service.mjs --port %PORT%
echo ------------------------------------------------------------
echo.
echo   Server stopped. Press any key to close this window.
pause >nul
endlocal
