#Requires -Version 5.1
<#
.SYNOPSIS
    Removes a Mission Control install.

.DESCRIPTION
    Stops the running server, removes the scheduled task (if registered),
    and deletes the install directory. The data directory is preserved
    by default; pass -DeleteData to wipe it as well.

.PARAMETER InstallDir
    The Mission Control install directory. Defaults to the parent of this
    script, then falls back to %LOCALAPPDATA%\MissionControl.

.PARAMETER DeleteData
    Also delete the data directory referenced by .env (or the default
    <InstallDir>\data). Prompts for confirmation.
#>

[CmdletBinding()]
param(
    [string]$InstallDir,
    [switch]$DeleteData,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) {
    if ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'launcher.js'))) {
        $InstallDir = $PSScriptRoot
    } else {
        $InstallDir = Join-Path $env:LOCALAPPDATA 'MissionControl'
    }
}

if (-not (Test-Path -LiteralPath $InstallDir)) {
    Write-Host "[Mission Control] Nothing to uninstall at $InstallDir."
    exit 0
}

Write-Host "[Mission Control] Uninstalling from $InstallDir"

# Resolve data dir from .env if present
$envPath = Join-Path $InstallDir '.env'
$dataDir = Join-Path $InstallDir 'data'
if (Test-Path -LiteralPath $envPath) {
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match '^\s*MISSION_CONTROL_DATA_DIR\s*=\s*(.+?)\s*$') {
            $dataDir = $matches[1].Trim('"').Trim("'")
            break
        }
    }
}

# Stop running server
$stopScript = Join-Path $InstallDir 'Stop.ps1'
if (Test-Path -LiteralPath $stopScript) {
    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -InstallDir $InstallDir
    } catch {
        Write-Warning "Stop.ps1 failed: $_"
    }
}

# Unregister scheduled task
$taskName = 'MissionControl'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Write-Host "[Mission Control] Removing scheduled task '$taskName'"
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Delete install dir
if (-not $Force) {
    $confirm = Read-Host "Delete install directory '$InstallDir'? [y/N]"
    if ($confirm -notmatch '^[Yy]') {
        Write-Host '[Mission Control] Cancelled. Install directory left in place.'
        exit 0
    }
}

# If we're running from inside the install dir we can't delete it while
# this PowerShell process is using files in it. Move script to temp first.
$selfPath = $MyInvocation.MyCommand.Path
$insideInstall = $false
if ($selfPath) {
    try {
        $resolvedSelf = (Resolve-Path -LiteralPath $selfPath).Path
        $resolvedInstall = (Resolve-Path -LiteralPath $InstallDir).Path
        $insideInstall = $resolvedSelf.StartsWith($resolvedInstall, [System.StringComparison]::OrdinalIgnoreCase)
    } catch {}
}

if ($insideInstall) {
    Write-Host '[Mission Control] Re-running from a temp copy to delete the install dir...'
    $tmpScript = Join-Path $env:TEMP "mc-uninstall-$([guid]::NewGuid().ToString('N')).ps1"
    Copy-Item -LiteralPath $selfPath -Destination $tmpScript -Force
    $args = @('-InstallDir', $InstallDir, '-Force')
    if ($DeleteData) { $args += '-DeleteData' }
    Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$tmpScript) + $args -Wait -WindowStyle Normal
    exit 0
}

Write-Host "[Mission Control] Removing $InstallDir"
Remove-Item -LiteralPath $InstallDir -Recurse -Force

if ($DeleteData) {
    if (Test-Path -LiteralPath $dataDir) {
        if (-not $Force) {
            $confirm = Read-Host "Also delete data directory '$dataDir'? This is permanent. [y/N]"
            if ($confirm -notmatch '^[Yy]') {
                Write-Host '[Mission Control] Data directory left in place.'
                exit 0
            }
        }
        Remove-Item -LiteralPath $dataDir -Recurse -Force
        Write-Host "[Mission Control] Deleted $dataDir"
    }
} else {
    if (Test-Path -LiteralPath $dataDir) {
        Write-Host "[Mission Control] Data preserved at $dataDir (delete with -DeleteData)."
    }
}

Write-Host '[Mission Control] Uninstalled.'
