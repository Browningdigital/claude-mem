' Claude Chat — Hidden Background Launcher
' This VBScript starts the Node server with no visible console window.
' The server runs silently until killed via Task Manager or taskkill.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Run npx tsx in hidden mode (0 = hidden, False = don't wait)
WshShell.CurrentDirectory = scriptDir
WshShell.Run "cmd /c set NO_OPEN=1 && npx tsx src/server.ts > claude-chat.log 2>&1", 0, False
