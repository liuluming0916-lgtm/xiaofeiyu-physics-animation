@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

rem 账本/Worker 自检一键验证：
rem   放在仓库根目录时，跑 release\小肥鱼物理解题动画\小肥鱼物理解题动画.exe；
rem   放在 exe 旁边时，直接跑当前目录的 exe。
if exist "%~dp0小肥鱼物理解题动画.exe" (
  cd /d "%~dp0"
) else (
  cd /d "%~dp0release\小肥鱼物理解题动画"
)

if not exist "小肥鱼物理解题动画.exe" (
  echo [ERR] 找不到 小肥鱼物理解题动画.exe
  echo       当前目录：%CD%
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   v1.1.19 账本自检（最多 90 秒）
echo ==========================================
echo   目录：%CD%
echo.
echo 请先关闭所有已打开的「小肥鱼物理解题动画」窗口，再继续。
echo.

set OD_SELFTEST=1
set OD_SELFTEST_OUT=%TEMP%\od-selftest.txt
if exist "%TEMP%\od-selftest.txt" del "%TEMP%\od-selftest.txt" >nul 2>nul
if exist "%TEMP%\od-shell.log" del "%TEMP%\od-shell.log" >nul 2>nul

echo 正在启动自检（不打开窗口）...
powershell -NoProfile -Command "$p = Start-Process -FilePath '.\小肥鱼物理解题动画.exe' -ArgumentList '--no-sandbox','--disable-gpu' -PassThru; if (-not $p.WaitForExit(90000)) { $p.Kill(); Write-Host 'TIMEOUT: 90 秒未退出，已结束进程' } else { Write-Host ('exit=' + $p.ExitCode) }"
set OD_SELFTEST=
set OD_SELFTEST_OUT=

echo.
echo ---- 自检结果：%TEMP%\od-selftest.txt ----
if exist "%TEMP%\od-selftest.txt" (
  type "%TEMP%\od-selftest.txt"
) else (
  echo （没有自检文件：说明 exe 没跑到 selftest，请看下面的 shell log）
)
echo.
echo ---- 启动日志：%TEMP%\od-shell.log ----
if exist "%TEMP%\od-shell.log" (
  type "%TEMP%\od-shell.log"
) else (
  echo （没有 shell log：说明 Electron 初始化阶段就退出了）
)
echo.
echo ==========================================
echo   把上面所有文字复制发我（不用截图）
echo ==========================================
pause
