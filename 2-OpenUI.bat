@echo off
cd /d "%~dp0"
setlocal

echo ============================================================
echo   Physics Animation - Open the UI
echo ============================================================
echo.
echo   1. A browser will open automatically.
echo   2. DO NOT close this black window while you look around.
echo      Closing it stops the page from working.
echo   3. When you are done, close this window.
echo.

start "" http://127.0.0.1:8080/

set "PY=C:\Users\Liu LuMing\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" -m http.server 8080 --directory "%~dp0web\dist"

echo.
echo   Server stopped.
echo   Press any key to close this window.
pause >nul
endlocal
