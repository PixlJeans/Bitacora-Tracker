@echo off
chcp 65001 >nul
title Bitacora Tracker - backup to GitHub
cd /d "%~dp0"
where git >nul 2>nul || (echo  [X] Git is missing: https://git-scm.com & pause & exit /b 1)
git add -A
git commit -m "Backup %date% %time:~0,5%"
git push -u origin HEAD && (echo. & echo  [OK] Backup saved on GitHub.) || (echo. & echo  [X] Push failed. Check the message above.)
pause
