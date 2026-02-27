@echo off
:: Claude Chat — Install Desktop Shortcut
:: Run once to create a desktop shortcut with the proper icon.

set "SCRIPT_DIR=%~dp0"
set "SHORTCUT=%USERPROFILE%\Desktop\Claude Chat.lnk"

:: Create shortcut via PowerShell
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$sc = $ws.CreateShortcut('%SHORTCUT%'); " ^
  "$sc.TargetPath = '%SCRIPT_DIR%start.bat'; " ^
  "$sc.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$sc.WindowStyle = 7; " ^
  "$sc.Description = 'Claude Chat - AI Assistant'; " ^
  "$sc.IconLocation = '%SCRIPT_DIR%icon.ico,0'; " ^
  "$sc.Save()"

if exist "%SHORTCUT%" (
    echo Desktop shortcut created: %SHORTCUT%
) else (
    echo Failed to create shortcut.
)

:: Also create Start Menu shortcut
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Claude Chat.lnk"
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$sc = $ws.CreateShortcut('%STARTMENU%'); " ^
  "$sc.TargetPath = '%SCRIPT_DIR%start.bat'; " ^
  "$sc.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$sc.WindowStyle = 7; " ^
  "$sc.Description = 'Claude Chat - AI Assistant'; " ^
  "$sc.IconLocation = '%SCRIPT_DIR%icon.ico,0'; " ^
  "$sc.Save()"

if exist "%STARTMENU%" (
    echo Start Menu shortcut created.
)

echo.
echo Done! You can now launch Claude Chat from your Desktop or Start Menu.
pause
