#Requires -Version 5.1
<#
.SYNOPSIS
    Builds dist\MissionControl-Setup-<version>.exe via Inno Setup.

.DESCRIPTION
    Wraps the staged bundle that scripts\package-windows.ps1 produces at
    dist\mission-control-windows\ into a single-file installer with the
    standard Windows wizard (Welcome -> Tasks -> Install -> Finish).

    Locates ISCC.exe in standard Inno Setup install paths or on PATH.
    If missing, prints clear instructions and exits non-zero.

    By default this runs scripts\package-windows.ps1 first to ensure the
    staged bundle is fresh. Pass -SkipStage to reuse the existing one
    (useful when iterating on the installer wizard only).

.PARAMETER SkipStage
    Don't re-run scripts\package-windows.ps1 — assume dist\mission-control-windows
    is already fresh.

.PARAMETER SkipBuild
    Forwarded to package-windows.ps1: skip pnpm install / pnpm build, reuse
    the existing .next/standalone bundle. Useful when only the packaging
    step has changed.

.PARAMETER NoNodeRuntime
    Forwarded to package-windows.ps1: builds without the bundled Node runtime.
    The target machine then needs Node 22+ on PATH.

.PARAMETER NodeVersion
    Forwarded to package-windows.ps1.

.PARAMETER OutputDir
    Where the .exe lands. Defaults to <repo>\dist.

.PARAMETER InnoSetupCompiler
    Explicit path to ISCC.exe. By default the script searches standard
    install locations and PATH.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
    powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1 -SkipStage
#>

[CmdletBinding()]
param(
    [switch]$SkipStage,
    [switch]$SkipBuild,
    [switch]$NoNodeRuntime,
    [string]$NodeVersion = '22.11.0',
    [string]$OutputDir,
    [string]$InnoSetupCompiler
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    $msg" -ForegroundColor Yellow }

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputDir) { $OutputDir = Join-Path $projectRoot 'dist' }
$stageDir = Join-Path $OutputDir 'mission-control-windows'
$issPath  = Join-Path $PSScriptRoot 'mission-control.iss'

if (-not (Test-Path -LiteralPath $issPath)) {
    throw "Missing Inno Setup script: $issPath"
}

# ── Locate ISCC.exe ─────────────────────────────────────────────────────────
function Find-IsccPath {
    param([string]$Hint)

    if ($Hint -and (Test-Path -LiteralPath $Hint)) { return (Resolve-Path -LiteralPath $Hint).Path }

    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 5\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }

    $fromPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }

    return $null
}

$iscc = Find-IsccPath -Hint $InnoSetupCompiler
if (-not $iscc) {
    Write-Host ''
    Write-Host 'ERROR: Inno Setup compiler (ISCC.exe) not found.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Install Inno Setup 6 first:' -ForegroundColor Yellow
    Write-Host '    winget install JRSoftware.InnoSetup'
    Write-Host '    # or download from https://jrsoftware.org/isdl.php'
    Write-Host ''
    Write-Host 'Then re-run this script. If ISCC.exe is in a non-standard location,'
    Write-Host 'pass -InnoSetupCompiler "<full-path-to-ISCC.exe>".'
    exit 1
}
Write-Ok "Using ISCC at $iscc"

# ── Stage (or reuse) ────────────────────────────────────────────────────────
if (-not $SkipStage) {
    Write-Step 'Running package-windows.ps1 to refresh the staged bundle'
    $pkgScript = Join-Path $PSScriptRoot 'package-windows.ps1'
    if (-not (Test-Path -LiteralPath $pkgScript)) {
        throw "package-windows.ps1 not found at $pkgScript"
    }
    # Spawn a fresh powershell.exe so parameter binding for the child script
    # is isolated from this script's own param block. Splatting via & in the
    # same shell can collide on prefix-matched names (e.g. -NoNodeRuntime
    # vs -NodeVersion), so we route through the launcher.
    $stageArgs = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $pkgScript,
        '-OutputDir', $OutputDir,
        '-NodeVersion', $NodeVersion,
        '-NoZip'
    )
    if ($NoNodeRuntime) { $stageArgs += '-NoNodeRuntime' }
    if ($SkipBuild)     { $stageArgs += '-SkipBuild' }

    & powershell.exe @stageArgs
    if ($LASTEXITCODE -ne 0) {
        throw "package-windows.ps1 failed (exit $LASTEXITCODE)"
    }
} else {
    Write-Warn2 'Skipping stage step per -SkipStage'
    if (-not (Test-Path -LiteralPath (Join-Path $stageDir 'app\server.js'))) {
        throw "Stage missing at $stageDir. Re-run without -SkipStage to build it."
    }
}

# ── Read version from package.json ──────────────────────────────────────────
$pkg = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$mcVersion = $pkg.version

# ── Compile installer ───────────────────────────────────────────────────────
Write-Step "Compiling installer (Inno Setup) for v$mcVersion"
$exeName = "MissionControl-Setup-$mcVersion.exe"
$exePath = Join-Path $OutputDir $exeName
if (Test-Path -LiteralPath $exePath) { Remove-Item -LiteralPath $exePath -Force }

$isccArgs = @(
    "/DMyAppVersion=$mcVersion",
    "/DStageDir=$stageDir",
    "/DOutputDir=$OutputDir",
    $issPath
)
Write-Host "ISCC args: $($isccArgs -join ' ')"
$compileStart = Get-Date
& $iscc @isccArgs
$compileExit = $LASTEXITCODE
$compileElapsed = (Get-Date) - $compileStart

if ($compileExit -ne 0) {
    throw "ISCC.exe exited with $compileExit. See the compiler output above."
}

if (-not (Test-Path -LiteralPath $exePath)) {
    throw "ISCC.exe reported success but $exePath does not exist."
}

$exeBytes = (Get-Item -LiteralPath $exePath).Length
$exeMB = [math]::Round($exeBytes / 1MB, 1)
Write-Ok ("Built {0} ({1} MB) in {2:N0}s" -f $exeName, $exeMB, $compileElapsed.TotalSeconds)

Write-Host ''
Write-Host 'Next steps:'
Write-Host "  1. Copy $exePath to the target Windows machine."
Write-Host "  2. Double-click MissionControl-Setup-$mcVersion.exe."
Write-Host '  3. Click through the wizard. Tick Autostart if you want it to launch on logon.'
