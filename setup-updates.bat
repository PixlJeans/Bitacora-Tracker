@echo off
chcp 65001 >nul
title Bitacora Tracker - set up automatic updates
cd /d "%~dp0"
rem Keep the GitHub workflow in sync (ci\installers.yml is the source; .github is protected from some tools)
if not exist ".github\workflows" mkdir ".github\workflows"
copy /Y "ci\installers.yml" ".github\workflows\installers.yml" >nul
if exist ".github\workflows\instaladores.yml" del ".github\workflows\instaladores.yml"
echo.
echo  ======================================================
echo    Bitacora Tracker - set up automatic updates (once)
echo  ======================================================
echo.
echo  This creates the key that SIGNS every update. Installed apps only accept
echo  versions signed with this key, so nobody else can push anything to them.
echo.

set "KEY=%USERPROFILE%\.tauri\bitacora-tracker.key"

where node >nul 2>nul || (echo  [X] Node.js is missing: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo  Installing dependencies...
  call npm install || goto :error
)

if exist "%KEY%" (
  echo  [i] A key already exists in %KEY% - reusing it.
) else (
  echo  [1/3] Creating the signing key...
  if not exist "%USERPROFILE%\.tauri" mkdir "%USERPROFILE%\.tauri"
  call npx tauri signer generate --ci -p "" -w "%KEY%" || goto :error
)

echo  [2/3] Saving the public key in the app...
call node scripts\set-public-key.mjs "%KEY%.pub" || goto :error

echo  [3/3] Saving the private key in GitHub (secret TAURI_SIGNING_PRIVATE_KEY)...
where gh >nul 2>nul
if not errorlevel 1 (
  gh secret set TAURI_SIGNING_PRIVATE_KEY -R PixlJeans/Bitacora-Tracker < "%KEY%" && goto :done
)
type "%KEY%" | clip
echo.
echo  It couldn't be saved automatically. Do it by hand (1 minute):
echo    1. GitHub opens on "New secret".
echo    2. Name:   TAURI_SIGNING_PRIVATE_KEY
echo    3. Secret: Ctrl+V  (the key is already copied)
echo    4. Click "Add secret".
start "" "https://github.com/PixlJeans/Bitacora-Tracker/settings/secrets/actions/new"
pause

:done
echo.
echo  [OK] Done. IMPORTANT: keep a copy of this folder somewhere safe:
echo       %USERPROFILE%\.tauri
echo       If the key is lost, installed apps won't accept updates anymore
echo       and you'd have to reinstall once with a new key.
echo.
echo  Next step: double-click publish-update.bat
pause
exit /b 0

:error
echo.
echo  [X] Something failed. Check the message above.
pause
exit /b 1
