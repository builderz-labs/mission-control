#Requires -Version 5.1
<#
.SYNOPSIS
    Mission Control Windows installer.

.DESCRIPTION
    Installs Mission Control to a per-user directory, generates secrets,
    optionally registers a scheduled task that launches the server at logon,
    and opens the setup page in the default browser.

    The script is intended to be run from within an extracted Mission Control
    Windows ZIP. It expects to find launcher.js, app/server.js, and (optionally)
    node/node.exe alongside this script.

.PARAMETER InstallDir
    Where to install. Defaults to %LOCALAPPDATA%\MissionControl.

.PARAMETER DataDir
    Where to keep the SQLite database and runtime data. Defaults to
    <InstallDir>\data so user data survives reinstalls in-place.

.PARAMETER Port
    TCP port to listen on. Defaults to 3000.

.PARAMETER Hostname
    Bind address. Defaults to 127.0.0.1 (loopback only). Use 0.0.0.0 to
    expose on the LAN.

.PARAMETER AutoStart
    Register a Scheduled Task that launches Mission Control on user logon.

.PARAMETER NoLaunch
    Skip starting the server and opening the browser after install.

.PARAMETER Force
    Overwrite existing install files. Does NOT touch the data directory.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -AutoStart -Port 3001
#>

[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'MissionControl'),
    [string]$DataDir,
    [int]$Port = 3000,
    [string]$Hostname = '127.0.0.1',
    [switch]$AutoStart,
    [switch]$NoLaunch,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[Mission Control] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[Mission Control] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[Mission Control] $msg" -ForegroundColor Yellow }

function New-RandomHex {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Test-PortFree {
    param([int]$P)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $P)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

# ── 0. Locate package source ─────────────────────────────────────────────────
$packageRoot = $PSScriptRoot
$sourceLauncher = Join-Path $packageRoot 'launcher.js'
$sourceApp      = Join-Path $packageRoot 'app'
$sourceNode     = Join-Path $packageRoot 'node'
$sourceStart    = Join-Path $packageRoot 'Start.bat'
$sourceStop     = Join-Path $packageRoot 'Stop.ps1'
$sourceUninst   = Join-Path $packageRoot 'Uninstall.ps1'
$sourceEnvEx    = Join-Path $packageRoot '.env.example'
$sourceReadme   = Join-Path $packageRoot 'README.txt'

if (-not (Test-Path -LiteralPath $sourceLauncher) -or -not (Test-Path -LiteralPath $sourceApp)) {
    throw "This installer must be run from an extracted Mission Control package. Missing launcher.js or app/ next to install.ps1 (looked in $packageRoot)."
}

if (-not $DataDir) { $DataDir = Join-Path $InstallDir 'data' }

Write-Info "Installing to $InstallDir"
Write-Info "Data directory:  $DataDir"
Write-Info "Listen address:  ${Hostname}:$Port"

# ── 1. Pre-flight checks ─────────────────────────────────────────────────────
if (-not (Test-PortFree -P $Port)) {
    Write-Warn2 "Port $Port appears to be in use. Mission Control may fail to bind. Pass -Port <n> to choose another."
}

$bundledNode = Join-Path $sourceNode 'node.exe'
$hasBundledNode = Test-Path -LiteralPath $bundledNode
if (-not $hasBundledNode) {
    $systemNode = Get-Command node -ErrorAction SilentlyContinue
    if (-not $systemNode) {
        throw "No Node.js found. Either repackage with the bundled runtime or install Node.js 22+ from https://nodejs.org and re-run."
    }
    $nodeVersion = & node --version
    Write-Warn2 "No bundled Node runtime; using system Node $nodeVersion. Native modules may need a matching ABI."
}

# ── 2. Stage files ───────────────────────────────────────────────────────────
if ((Test-Path -LiteralPath $InstallDir) -and -not $Force) {
    $existingApp = Join-Path $InstallDir 'app\server.js'
    if (Test-Path -LiteralPath $existingApp) {
        Write-Warn2 "Existing install detected at $InstallDir. Re-run with -Force to overwrite (data is preserved either way)."
    }
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir    | Out-Null

$copyTargets = @(
    @{ Src = $sourceLauncher; Dst = (Join-Path $InstallDir 'launcher.js'); Required = $true }
    @{ Src = $sourceStart;    Dst = (Join-Path $InstallDir 'Start.bat');   Required = $true }
    @{ Src = $sourceStop;     Dst = (Join-Path $InstallDir 'Stop.ps1');    Required = $true }
    @{ Src = $sourceUninst;   Dst = (Join-Path $InstallDir 'Uninstall.ps1'); Required = $true }
    @{ Src = $sourceReadme;   Dst = (Join-Path $InstallDir 'README.txt');  Required = $false }
    @{ Src = $sourceEnvEx;    Dst = (Join-Path $InstallDir '.env.example'); Required = $false }
)

foreach ($t in $copyTargets) {
    if (Test-Path -LiteralPath $t.Src) {
        Copy-Item -LiteralPath $t.Src -Destination $t.Dst -Force
    } elseif ($t.Required) {
        throw "Missing required package file: $($t.Src)"
    }
}

Write-Info 'Copying application bundle (this is the largest step)'
$destApp = Join-Path $InstallDir 'app'
if (Test-Path -LiteralPath $destApp) { Remove-Item -LiteralPath $destApp -Recurse -Force }
Copy-Item -LiteralPath $sourceApp -Destination $destApp -Recurse -Force

if ($hasBundledNode) {
    Write-Info 'Copying Node.js runtime'
    $destNode = Join-Path $InstallDir 'node'
    if (Test-Path -LiteralPath $destNode) { Remove-Item -LiteralPath $destNode -Recurse -Force }
    Copy-Item -LiteralPath $sourceNode -Destination $destNode -Recurse -Force
}

# ── 3. Generate .env (only if missing) ──────────────────────────────────────
$envPath = Join-Path $InstallDir '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    Write-Info 'Generating .env with random secrets'
    $authSecret = New-RandomHex -Bytes 32
    $apiKey     = New-RandomHex -Bytes 32

    $envLines = @(
        '# Mission Control runtime configuration.',
        '# Generated by install.ps1 on first install. Edit freely.',
        '',
        "PORT=$Port",
        "MC_HOSTNAME=$Hostname",
        "AUTH_SECRET=$authSecret",
        "API_KEY=$apiKey",
        "MISSION_CONTROL_DATA_DIR=$DataDir",
        '',
        '# Auth: visit http://localhost:'+ $Port + '/setup on first run to create an admin,',
        '# or seed via AUTH_USER / AUTH_PASS below.',
        '# AUTH_USER=admin',
        '# AUTH_PASS=change-me',
        '',
        'MC_COOKIE_SAMESITE=strict',
        'MC_ALLOWED_HOSTS=localhost,127.0.0.1,::1',
        'NEXT_PUBLIC_GATEWAY_OPTIONAL=true'
    )
    Set-Content -LiteralPath $envPath -Value $envLines -Encoding utf8
} else {
    Write-Info '.env already present; leaving it untouched'
    # Make sure PORT/HOSTNAME args still take effect for *this* launch via process env.
}

# ── 4. Optional: Scheduled Task at logon ─────────────────────────────────────
$taskName = 'MissionControl'
if ($AutoStart) {
    Write-Info "Registering scheduled task '$taskName' to start Mission Control at logon"
    $startBat = Join-Path $InstallDir 'Start.bat'
    $action = New-ScheduledTaskAction -Execute $startBat -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
    Write-Ok "Scheduled task registered. Manage with Task Scheduler ('$taskName')."
} else {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Write-Info "Existing scheduled task '$taskName' left in place."
    }
}

# ── 5. Launch ────────────────────────────────────────────────────────────────
if ($NoLaunch) {
    Write-Ok "Install complete. Run Start.bat in $InstallDir when you're ready."
    exit 0
}

Write-Info 'Starting Mission Control...'
$startBatPath = Join-Path $InstallDir 'Start.bat'
$proc = Start-Process -FilePath $startBatPath -WorkingDirectory $InstallDir -WindowStyle Hidden -PassThru

# Poll /login until the server answers (or give up after ~45s)
$url = "http://${Hostname}:$Port/login"
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
            $ready = $true
            break
        }
    } catch {
        # keep polling
    }
    if ($proc.HasExited) {
        Write-Warn2 "Launcher exited early (code $($proc.ExitCode)). Check logs and try Start.bat manually."
        break
    }
}

if ($ready) {
    Write-Ok "Mission Control is up at http://${Hostname}:$Port"
    Start-Process "http://${Hostname}:$Port/setup"
} else {
    Write-Warn2 "Server did not respond on $url within 45s. Try running Start.bat manually to see startup output."
}

Write-Host ''
Write-Host 'Files:'
Write-Host "  Install : $InstallDir"
Write-Host "  Data    : $DataDir"
Write-Host "  Env     : $envPath"
Write-Host ''
Write-Host 'Useful commands (from the install dir):'
Write-Host "  Start.bat                          # run in foreground"
Write-Host "  powershell -File Stop.ps1          # stop"
Write-Host "  powershell -File Uninstall.ps1     # remove (prompts before deleting data)"
