@echo off
chcp 65001 >nul
title Bitacora Tracker - install build tools (once)
cd /d "%~dp0"
echo.
echo  ======================================================
echo    Install the tools to build the app on this laptop
echo  ======================================================
echo.
echo  Installs (only what's missing):
echo    1. Visual Studio Build Tools (C++)   ~ 3-6 GB, 10-20 min
echo    2. Rust                              ~ 1 GB
echo  Windows will ask for permission (click Yes). Run this only once.
echo.
pause

where winget >nul 2>nul || (echo  [X] winget is missing. Update "App Installer" from the Microsoft Store and try again. & pause & exit /b 1)

echo  [1/2] Visual Studio Build Tools (C++)...
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

echo  [2/2] Rust...
where cargo >nul 2>nul
if errorlevel 1 (
  winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
) else (
  echo        Rust is already installed.
)

echo.
echo  [OK] Done. CLOSE this window and then double-click update-app.bat
echo       (the new tools are only found in a new window).
pause
