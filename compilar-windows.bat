@echo off
chcp 65001 >nul
title Bitacora Tracker - compilar instalador de Windows
cd /d "%~dp0"
echo.
echo  ==============================================
echo    Bitacora Tracker - instalador para Windows
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Falta Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a ejecutar.
  pause & exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo  [X] Falta Rust. Instalalo desde https://rustup.rs ^(opcion por defecto^).
  echo      Rust tambien pide "Visual Studio Build Tools" con "Desarrollo para escritorio con C++".
  pause & exit /b 1
)

echo  [1/3] Instalando dependencias...
call npm install || goto :error

echo  [2/3] Generando iconos...
call npx tauri icon src-tauri\icons\icon.png || goto :error

echo  [3/3] Compilando (la primera vez tarda varios minutos)...
call npm run tauri build || goto :error

echo.
echo  [OK] Listo. Instaladores en:
echo       src-tauri\target\release\bundle\nsis\   (.exe)
echo       src-tauri\target\release\bundle\msi\    (.msi)
start "" "src-tauri\target\release\bundle\nsis"
pause
exit /b 0

:error
echo.
echo  [X] Algo fallo. Revisa el mensaje de arriba.
pause
exit /b 1
