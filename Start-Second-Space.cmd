@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0scripts\start-dev.ps1"
if errorlevel 1 pause
