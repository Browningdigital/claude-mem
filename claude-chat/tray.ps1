# Claude Chat — System Tray Controller
# Creates a system tray icon that manages the background server.
# Launched by start.bat or the main exe wrapper.

param(
    [int]$Port = 3456,
    [int]$ServerPid = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ===== Create icon programmatically (purple C on dark bg) =====
function New-ClaudeIcon {
    $bmp = New-Object System.Drawing.Bitmap(32, 32)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAlias'

    # Dark background with rounded feel
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 10, 10))
    $g.FillRectangle($bgBrush, 0, 0, 32, 32)

    # Purple accent ring
    $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 196, 161, 255), 2)
    $g.DrawEllipse($ringPen, 2, 2, 27, 27)

    # "C" letter in purple
    $font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 196, 161, 255))
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF(0, 0, 32, 32)
    $g.DrawString("C", $font, $textBrush, $rect, $sf)

    $g.Dispose()

    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    return $icon
}

# ===== Create disconnected icon (red ring) =====
function New-DisconnectedIcon {
    $bmp = New-Object System.Drawing.Bitmap(32, 32)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAlias'

    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 10, 10))
    $g.FillRectangle($bgBrush, 0, 0, 32, 32)

    $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 200, 80, 80), 2)
    $g.DrawEllipse($ringPen, 2, 2, 27, 27)

    $font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 200, 80, 80))
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF(0, 0, 32, 32)
    $g.DrawString("C", $font, $textBrush, $rect, $sf)

    $g.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

# ===== Check server health =====
function Test-Server {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port/api/ping" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

# ===== Start server if not running =====
function Start-Server {
    $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
    if (-not $scriptDir) { $scriptDir = Get-Location }

    # Check if already running
    if (Test-Server) { return }

    # Start the server hidden
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c cd /d `"$scriptDir`" && npx tsx src/server.ts"
    $psi.WorkingDirectory = $scriptDir
    $psi.WindowStyle = 'Hidden'
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false
    $psi.EnvironmentVariables["NO_OPEN"] = "1"

    $script:serverProcess = [System.Diagnostics.Process]::Start($psi)
}

# ===== Setup =====
$connectedIcon = New-ClaudeIcon
$disconnectedIcon = New-DisconnectedIcon

# Create NotifyIcon
$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = $disconnectedIcon
$trayIcon.Text = "Claude Chat"
$trayIcon.Visible = $true

# Context menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = New-Object System.Windows.Forms.ToolStripMenuItem("Open Claude Chat")
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$openItem.Add_Click({
    Start-Process "http://localhost:$Port"
})

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem("Restart Server")
$restartItem.Add_Click({
    # Kill existing server
    if ($script:serverProcess -and !$script:serverProcess.HasExited) {
        $script:serverProcess.Kill()
        Start-Sleep -Seconds 1
    }
    # Also kill any orphaned node processes on our port
    $portProc = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $portProc) {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
    Start-Server
    $trayIcon.ShowBalloonTip(2000, "Claude Chat", "Server restarting...", [System.Windows.Forms.ToolTipIcon]::Info)
})

$sep = New-Object System.Windows.Forms.ToolStripSeparator

$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem("Quit")
$quitItem.Add_Click({
    # Kill server
    if ($script:serverProcess -and !$script:serverProcess.HasExited) {
        $script:serverProcess.Kill()
    }
    $portProc = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $portProc) {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }

    $trayIcon.Visible = $false
    $trayIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$menu.Items.AddRange(@($openItem, $restartItem, $sep, $quitItem))
$trayIcon.ContextMenuStrip = $menu

# Double-click tray icon → open browser
$trayIcon.Add_DoubleClick({
    Start-Process "http://localhost:$Port"
})

# ===== Start server =====
Start-Server

# ===== Health check timer (every 5s) =====
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    $alive = Test-Server
    if ($alive) {
        $trayIcon.Icon = $connectedIcon
        $trayIcon.Text = "Claude Chat — Running"
    } else {
        $trayIcon.Icon = $disconnectedIcon
        $trayIcon.Text = "Claude Chat — Disconnected"
        # Auto-restart server if it died
        Start-Server
    }
})
$timer.Start()

# Initial check + open browser after brief wait
Start-Sleep -Seconds 3
if (Test-Server) {
    $trayIcon.Icon = $connectedIcon
    $trayIcon.Text = "Claude Chat — Running"
    Start-Process "http://localhost:$Port"
    $trayIcon.ShowBalloonTip(3000, "Claude Chat", "Running at http://localhost:$Port", [System.Windows.Forms.ToolTipIcon]::Info)
} else {
    $trayIcon.ShowBalloonTip(3000, "Claude Chat", "Starting server...", [System.Windows.Forms.ToolTipIcon]::Info)
}

# Run message loop (keeps the tray alive)
[System.Windows.Forms.Application]::Run()
