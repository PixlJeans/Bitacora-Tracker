@echo off
chcp 65001 >nul
title Bitacora Tracker - publish an update
cd /d "%~dp0"
rem Keep the GitHub workflow in sync (ci\installers.yml is the source; .github is protected from some tools)
if not exist ".github\workflows" mkdir ".github\workflows"
copy /Y "ci\installers.yml" ".github\workflows\installers.yml" >nul
if exist ".github\workflows\instaladores.yml" del ".github\workflows\instaladores.yml"
echo.
echo  ==============================================
echo    Bitacora Tracker - publish an update
echo  ==============================================
echo.
echo  Bumps the version, sends the changes to GitHub, and GitHub builds and publishes.
echo  In about 15 minutes the installed apps (Windows and Mac) update themselves.
echo.

where git >nul 2>nul || (echo  [X] Git is missing: https://git-scm.com & pause & exit /b 1)
where node >nul 2>nul || (echo  [X] Node.js is missing: https://nodejs.org & pause & exit /b 1)
findstr /C:"PENDING" src-tauri\tauri.conf.json >nul && (
  echo  [X] Run setup-updates.bat first ^(only once^).
  pause & exit /b 1
)

set /p NOTE=  What did you change? (one line, e.g. "Fix dates"):
if "%NOTE%"=="" set "NOTE=Improvements and fixes"

for /f "delims=" %%v in ('node scripts\bump-version.mjs') do set "VER=%%v"
if "%VER%"=="" goto :error
echo  New version: %VER%

git add -A || goto :error
git commit -m "v%VER%: %NOTE%" || goto :error
git tag "v%VER%" || goto :error
git push -u origin HEAD || goto :error
git push origin "v%VER%" || goto :error

echo.
echo  [OK] Sent. GitHub is building version %VER%.
echo       You can follow it on the page that opens (Actions).
echo       When it finishes, each installed app will show "Hay una version nueva".
start "" "https://github.com/PixlJeans/Bitacora-Tracker/actions"
pause
exit /b 0

:error
echo.
echo  [X] Something failed. Check the message above.
pause
exit /b 1
