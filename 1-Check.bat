@echo off
cd /d "%~dp0"
setlocal

echo ============================================================
echo   Physics Animation - Full Check
echo ============================================================
echo.
echo   This runs all 56 checks. It takes about 2-3 minutes.
echo   Just wait. When it stops, look for the RESULT box below.
echo.
echo   Press any key to start...
pause >nul

set "NODE_EXE=C:\Users\Liu LuMing\AppData\Local\OpenDesign\toolchains\dsh\node-v24.19.0-win-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo.
echo ------------------------------------------------------------
echo   Encoding guard (UTF-8 / BOM / GBK mojibake)
"%NODE_EXE%" tools\check-encoding.mjs
if errorlevel 1 goto ENCODING_FAIL

echo.
echo ------------------------------------------------------------
"%NODE_EXE%" tools\verify-all.mjs
set "RC=%ERRORLEVEL%"
echo ------------------------------------------------------------
echo.

if "%RC%"=="0" goto PASS

echo   ##########################################
echo   #  RESULT:  SOME CHECKS FAILED
echo   #  Take a screenshot of this window and
echo   #  send it to the AI.
echo   ##########################################
echo.
echo   Report file: tests\reports\summary.md
goto END

:ENCODING_FAIL
echo.
echo   ##########################################
echo   #  RESULT:  ENCODING CHECK FAILED
echo   #  A source file is not valid UTF-8,
echo   #  or contains BOM / GBK mojibake.
echo   #  Do NOT rewrite it with PowerShell.
echo   #  Restore from git / editor history first.
echo   ##########################################
echo.
goto END

:PASS
echo   ##########################################
echo   #  RESULT:  ALL CHECKS PASSED
echo   #  Everything is working.
echo   ##########################################
echo.
echo   Report file: tests\reports\summary.md

:END
echo.
echo   Press any key to close this window.
pause >nul
endlocal
