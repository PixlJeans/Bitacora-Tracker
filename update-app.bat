@echo off
chcp 65001 >nul
title Bitacora Tracker - update the app on this laptop
cd /d "%~dp0"
rem Keep the GitHub workflow in sync (ci\installers.yml is the source)
if not exist ".github\workflows" mkdir ".github\workflows"
copy /Y "ci\installers.yml" ".github\workflows\installers.yml" >nul
echo.
echo  ======================================================
echo    Bitacora Tracker - update the app on this laptop
echo  ======================================================
echo.
echo  Builds the app from this folder, installs it over the old one and opens it.
echo  Your data (Documents\Bitacora Tracker) is not touched. Then backs up the code to GitHub.
echo.

where node >nul 2>nul || (echo  [X] Node.js is missing: https://nodejs.org & pause & exit /b 1)
where cargo >nul 2>nul || (echo  [X] Rust is missing: run install-tools.bat first ^(once^), then open this again. & pause & exit /b 1)

rustup show active-toolchain >nul 2>nul || call rustup default stable
echo  [1/5] Dependencies...
call npm install --no-audit --no-fund || goto :error

echo  [2/5] Tests...
call npm test || goto :error

for /f "delims=" %%v in ('node scripts\bump-version.mjs') do set "VER=%%v"
echo  [3/5] Building version %VER% (the first time takes 5-10 min, then 1-3 min)...
call npx tauri build --bundles nsis || goto :error

set "SETUP="
for /f "delims=" %%f in ('dir /b /o-d "src-tauri\target\release\bundle\nsis\*_x64-setup.exe" 2^>nul') do if not defined SETUP set "SETUP=src-tauri\target\release\bundle\nsis\%%f"
if not defined SETUP (echo  [X] Installer not found. & goto :error)

echo  [4/5] Installing %SETUP% ...
taskkill /IM "Bitacora Tracker.exe" /F >nul 2>nul
timeout /t 2 /nobreak >nul
"%SETUP%" /S
timeout /t 3 /nobreak >nul
if exist "%LOCALAPPDATA%\Bitacora Tracker\Bitacora Tracker.exe" (
  start "" "%LOCALAPPDATA%\Bitacora Tracker\Bitacora Tracker.exe"
) else if exist "%ProgramFiles%\Bitacora Tracker\Bitacora Tracker.exe" (
  start "" "%ProgramFiles%\Bitacora Tracker\Bitacora Tracker.exe"
) else (
  echo        Installed. Open "Bitacora Tracker" from the Start menu.
)

echo  [5/5] Backup to GitHub...
call :backup "v%VER%"

echo.
echo  [OK] Version %VER% installed.
pause
exit /b 0

:backup
where git >nul 2>nul || (echo        [i] Git not installed: backup skipped. & exit /b 0)
git add -A >nul 2>nul
git commit -q -m "%~1 (backup %date%)" >nul 2>nul
git push -q -u origin HEAD 2>nul && (echo        Backup saved on GitHub.) || (echo        [i] Backup to GitHub failed ^(no internet?^). The app is installed anyway.)
exit /b 0

:error
echo.
echo  [X] Something failed. Check the message above (nothing was installed).
pause
exit /b 1
