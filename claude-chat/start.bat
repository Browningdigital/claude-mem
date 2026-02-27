@echo off
:: Claude Chat — Desktop App Launcher
:: Starts the server in background with system tray icon.
:: Right-click the tray icon to manage or quit.

:: Check if already running
curl -s http://localhost:3456/api/ping >nul 2>&1
if %errorlevel%==0 (
    echo Already running. Opening browser...
    start http://localhost:3456
    exit /b
)

:: Launch with system tray (PowerShell handles everything)
echo Starting Claude Chat...
start /min powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0tray.ps1"

:: This window closes immediately — the tray icon takes over
exit
