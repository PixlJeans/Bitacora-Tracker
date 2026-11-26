@echo off
chcp 65001 >nul
title Bitacora Tracker - development mode
cd /d "%~dp0"
if not exist node_modules call npm install
echo Opening the app in development mode (changes show up when you save)...
call npm run tauri dev
pause
