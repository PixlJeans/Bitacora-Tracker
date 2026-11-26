@echo off
chcp 65001 >nul
title Bitacora Tracker - prepare GitHub
cd /d "%~dp0"
rem Keep the GitHub workflow in sync (ci\installers.yml is the source; .github is protected from some tools)
if not exist ".github\workflows" mkdir ".github\workflows"
copy /Y "ci\installers.yml" ".github\workflows\installers.yml" >nul
if exist ".github\workflows\instaladores.yml" del ".github\workflows\instaladores.yml"
echo Done: .github\workflows\installers.yml created. You can push the folder to GitHub now.
pause
