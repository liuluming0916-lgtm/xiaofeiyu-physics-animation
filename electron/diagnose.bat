@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ==========================================
echo  Physical Animation v1.1.19 - Diagnose
echo ==========================================
echo.
echo This script only CHECKS things. Please send me ALL output below.
echo.

set "EXE=physical-app.exe"
for %%F in (*.exe) do (
  if /i not "%%~nxF"=="electron.exe" set "EXE=%%~nxF"
)
if not exist "%EXE%" (
  echo [ERR] no exe found in: %CD%
  pause
  exit /b 1
)

echo [0/4] environment
echo   cwd            : %CD%
echo   exe            : %EXE%
echo   arch           : %PROCESSOR_ARCHITECTURE%
echo   RUN_AS_NODE    = [%ELECTRON_RUN_AS_NODE%]
echo.

echo [1/4] version probe (no window)
set ELECTRON_RUN_AS_NODE=
"%EXE%" --version
echo   exit code = %ERRORLEVEL%
echo.

echo [2/4] headless selftest (starts local service, writes log, up to 90s)
set OD_SELFTEST=1
set OD_SELFTEST_OUT=%TEMP%\od-selftest.txt
if exist "%TEMP%\od-shell.log" del "%TEMP%\od-shell.log" >nul 2>nul
if exist "%TEMP%\od-selftest.txt" del "%TEMP%\od-selftest.txt" >nul 2>nul
start "" /wait "%EXE%"
set OD_SELFTEST=
set OD_SELFTEST_OUT=
echo   exit code = %ERRORLEVEL%
echo.
echo   -- selftest: %TEMP%\od-selftest.txt --
if exist "%TEMP%\od-selftest.txt" (
  type "%TEMP%\od-selftest.txt"
) else (
  echo   (no selftest result = the app did not reach the selftest)
)
echo.
echo   -- shell log: %TEMP%\od-shell.log --
if exist "%TEMP%\od-shell.log" (
  type "%TEMP%\od-shell.log"
) else (
  echo   (no log at all = our JS never ran, i.e. crashed inside Electron init)
)
echo.

echo [3/4] normal launch (window; wait 10s and check process)
set OD_SELFTEST=
start "" "%EXE%"
timeout /t 10 >nul
tasklist /fi "imagename eq %EXE%" 2>nul | find /i "%EXE%" >nul
if errorlevel 1 (
  echo   process: NOT running ^(no window, process already exited^)
) else (
  echo   process: RUNNING ^(window should be visible now^)
)
echo.

echo [4/4] recent application errors (if any)
powershell -NoProfile -Command "Get-EventLog -LogName Application -Newest 8 -EntryType Error -ErrorAction SilentlyContinue | Where-Object { $_.Source -match 'Application Error|Application Hang' } | ForEach-Object { '  ' + $_.TimeGenerated.ToString('HH:mm:ss') + '  ' + $_.Source }" 2>nul
echo.

echo ==========================================
echo  Done. Please send me everything above.
echo ==========================================
pause
