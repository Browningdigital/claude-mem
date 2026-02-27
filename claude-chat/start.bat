@echo off
:: Claude Chat — Background Launcher
:: Starts the server hidden and opens the browser.
:: Close by killing node.exe in Task Manager or running: taskkill /f /im node.exe

:: Check if already running
curl -s http://localhost:3456/api/ping >nul 2>&1
if %errorlevel%==0 (
    echo Already running. Opening browser...
    start http://localhost:3456
    exit /b
)

:: Launch hidden via VBScript (no cmd window stays open)
echo Starting Claude Chat in background...
cscript //nologo "%~dp0start.vbs"
echo Waiting for server...

:: Wait for server to come up (max 15s)
set /a tries=0
:waitloop
if %tries% geq 15 (
    echo Server failed to start. Check logs.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
curl -s http://localhost:3456/api/ping >nul 2>&1
if %errorlevel%==0 (
    echo Claude Chat running at http://localhost:3456
    start http://localhost:3456
    exit /b
)
set /a tries+=1
goto waitloop
