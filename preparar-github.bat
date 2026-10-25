@echo off
cd /d "%~dp0"
if not exist ".github\workflows" mkdir ".github\workflows"
copy /Y "ci\instaladores.yml" ".github\workflows\instaladores.yml" >nul
echo Listo: .github\workflows\instaladores.yml creado. Ya puedes subir la carpeta a GitHub.
pause
