@echo off
chcp 65001 >nul
title Bitacora Tracker - modo desarrollo
cd /d "%~dp0"
if not exist node_modules call npm install
echo Abriendo la app en modo desarrollo (los cambios se ven al guardar)...
call npm run tauri dev
pause
