@echo off
chcp 65001 >nul
title Bitacora Tracker - build Windows installer
cd /d "%~dp0"
echo.
echo  ==============================================
echo    Bitacora Tracker - Windows installer
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is missing. Install it from https://nodejs.org ^(LTS version^) and run this again.
  pause & exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo  [X] Rust is missing. Install it from https://rustup.rs ^(default option^).
  echo      Rust also needs "Visual Studio Build Tools" with "Desktop development with C++".
  pause & exit /b 1
)

echo  [1/3] Installing dependencies...
call npm install || goto :error

echo  [2/3] Generating icons...
call npx tauri icon src-tauri\icons\icon.png || goto :error

echo  [3/3] Building (the first time takes several minutes)...
call npm run tauri build || goto :error

echo.
echo  [OK] Done. Installers in:
echo       src-tauri\target\release\bundle\nsis\   (.exe)
echo       src-tauri\target\release\bundle\msi\    (.msi)
start "" "src-tauri\target\release\bundle\nsis"
pause
exit /b 0

:error
echo.
echo  [X] Something failed. Check the message above.
pause
exit /b 1
