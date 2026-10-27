@echo off
chcp 65001 >nul
cd /d "%~dp0"
title XFY 2.0
where node >nul 2>nul || (echo [XFY] Node.js not found. Install Node 22+ first. & pause & exit /b 1)
if not exist "node_modules" (echo [XFY] First run, installing dependencies... & call npm install --cache .npm-cache --no-audit --no-fund)
node scripts\launch.ts
if errorlevel 1 pause
