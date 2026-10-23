@echo off
cd /d "%~dp0"
setlocal

echo ============================================================
echo   Enable encoding guard (pre-commit hook)
echo ============================================================
echo.
echo   This enables .githooks\pre-commit for THIS repository.
echo   Every commit will then check staged files for:
echo     - invalid UTF-8
echo     - UTF-16 / BOM
echo     - high-density GBK mojibake
echo.
echo   Note: do this in a normal PowerShell / VS Code terminal.
echo   DSH sandbox cannot run Git hooks (bash signal-pipe EPERM).
echo.

git config core.hooksPath .githooks
if errorlevel 1 goto FAIL

echo   OK: core.hooksPath = .githooks
echo.
echo   To disable later:
echo     git config --unset core.hooksPath
echo.
pause
exit /b 0

:FAIL
echo   FAILED: could not set core.hooksPath.
echo   Make sure this folder is a Git repository and Git is installed.
echo.
pause
exit /b 1
