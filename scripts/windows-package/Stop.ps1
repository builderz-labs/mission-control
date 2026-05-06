#Requires -Version 5.1
<#
    Mission Control - Stop.ps1
    Gracefully stops any running Mission Control server processes started
    from this install directory. Matches by command line so it does not
    affect unrelated Node processes.
#>

[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$installRoot = (Resolve-Path -LiteralPath $InstallDir).Path
$launcherPath = Join-Path $installRoot 'launcher.js'

if (-not (Test-Path -LiteralPath $launcherPath)) {
    Write-Error "launcher.js not found in $installRoot"
    exit 1
}

$processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -like "*$launcherPath*" -or
            $_.CommandLine -like "*$installRoot\app\server.js*"
        )
    }

if (-not $processes) {
    Write-Host '[Mission Control] No running server found for this install.'
    exit 0
}

foreach ($proc in $processes) {
    Write-Host "[Mission Control] Stopping pid=$($proc.ProcessId)"
    try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    } catch {
        Write-Warning "Failed to stop pid=$($proc.ProcessId): $_"
    }
}

Write-Host '[Mission Control] Stopped.'
