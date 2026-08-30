@echo off
title PH Stock Dashboard
echo.
echo  Starting PH Stock Dashboard...
echo  Your browser will open automatically.
echo  Press Ctrl+C or close this window to stop.
echo.
cd /d "%~dp0"
node server.js
pause
