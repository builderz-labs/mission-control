#Requires -Version 5.1
<#
.SYNOPSIS
    Builds a self-contained Mission Control Windows ZIP.

.DESCRIPTION
    Produces dist/mission-control-windows-<version>.zip with:
      - Prebuilt Next.js standalone bundle (.next/standalone + static + public)
      - A portable Node.js runtime (downloaded once, cached under dist/node-cache/)
      - Native modules (better-sqlite3, node-pty) compiled for the bundled
        Node version + win32-x64
      - install.ps1, launcher.js, Start.bat, Stop.ps1, Uninstall.ps1, README.txt

    Run this on a Windows machine with Node 22+ and pnpm. The script forces
    native modules to be rebuilt against the *bundled* Node version so the
    package works regardless of what's installed on the target.

.PARAMETER NodeVersion
    Node.js version to bundle. Defaults to a current 22 LTS release.

.PARAMETER OutputDir
    Where the staged folder and final ZIP land. Default: dist/

.PARAMETER SkipBuild
    Skip pnpm install / pnpm build. Useful for iterating on packaging logic
    when .next/standalone is already up-to-date.

.PARAMETER NoNodeRuntime
    Don't bundle Node.js. Smaller ZIP (~70 MB savings) but the target must
    have Node 22+ on PATH.

.PARAMETER NoZip
    Stop after staging. Useful for inspecting the bundle before zipping.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\package-windows.ps1
#>

[CmdletBinding()]
param(
    [string]$NodeVersion = '22.11.0',
    [string]$OutputDir,
    [switch]$SkipBuild,
    [switch]$NoNodeRuntime,
    [switch]$NoZip
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# ── Paths ───────────────────────────────────────────────────────────────────
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputDir) { $OutputDir = Join-Path $projectRoot 'dist' }
$cacheDir   = Join-Path $OutputDir 'node-cache'
$stageDir   = Join-Path $OutputDir 'mission-control-windows'
$packageSrc = Join-Path $projectRoot 'scripts\windows-package'
$standalone = Join-Path $projectRoot '.next\standalone'

if (-not (Test-Path -LiteralPath $packageSrc)) {
    throw "Expected packaging templates at $packageSrc"
}

$pkg = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$mcVersion = $pkg.version

Write-Step "Mission Control v$mcVersion -> Windows package (Node $NodeVersion)"
Write-Host "    project: $projectRoot"
Write-Host "    output:  $OutputDir"

# ── 1. Sanity ───────────────────────────────────────────────────────────────
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm not found on PATH. Run `corepack enable` and retry.'
}

# ── 2. pnpm install + build ─────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step 'pnpm install --frozen-lockfile'
    Push-Location $projectRoot
    try {
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }

    Write-Step 'pnpm build (Next.js standalone)'
    Push-Location $projectRoot
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
} else {
    Write-Warn2 'Skipping install/build per -SkipBuild'
}

if (-not (Test-Path -LiteralPath (Join-Path $standalone 'server.js'))) {
    throw "Standalone bundle not found at $standalone\server.js. Run without -SkipBuild."
}

# ── 3. Copy static + public into standalone (deploy-standalone.sh equivalent)
Write-Step 'Copying .next/static and public/ into standalone bundle'
$staticSrc = Join-Path $projectRoot '.next\static'
$staticDst = Join-Path $standalone '.next\static'
if (Test-Path -LiteralPath $staticSrc) {
    if (Test-Path -LiteralPath $staticDst) { Remove-Item -LiteralPath $staticDst -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $staticDst) | Out-Null
    Copy-Item -LiteralPath $staticSrc -Destination $staticDst -Recurse -Force
}
$publicSrc = Join-Path $projectRoot 'public'
$publicDst = Join-Path $standalone 'public'
if (Test-Path -LiteralPath $publicSrc) {
    if (Test-Path -LiteralPath $publicDst) { Remove-Item -LiteralPath $publicDst -Recurse -Force }
    Copy-Item -LiteralPath $publicSrc -Destination $publicDst -Recurse -Force
}
Write-Ok 'standalone bundle is complete'

# ── 4. Stage portable Node ──────────────────────────────────────────────────
$nodeStage = Join-Path $stageDir 'node'
if (-not $NoNodeRuntime) {
    $nodeZipName = "node-v$NodeVersion-win-x64.zip"
    $nodeUrl     = "https://nodejs.org/dist/v$NodeVersion/$nodeZipName"
    $nodeZipPath = Join-Path $cacheDir $nodeZipName
    $nodeExtract = Join-Path $cacheDir "node-v$NodeVersion-win-x64"

    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

    if (-not (Test-Path -LiteralPath $nodeZipPath)) {
        Write-Step "Downloading $nodeUrl"
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZipPath -UseBasicParsing
    } else {
        Write-Ok "Using cached $nodeZipName"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $nodeExtract 'node.exe'))) {
        Write-Step 'Extracting Node.js'
        if (Test-Path -LiteralPath $nodeExtract) { Remove-Item -LiteralPath $nodeExtract -Recurse -Force }
        Expand-Archive -LiteralPath $nodeZipPath -DestinationPath $cacheDir -Force
    }

    if (-not (Test-Path -LiteralPath (Join-Path $nodeExtract 'node.exe'))) {
        throw "Node.js extraction did not produce node.exe at $nodeExtract"
    }
} else {
    Write-Warn2 'Skipping bundled Node runtime per -NoNodeRuntime'
}

# ── 5. Rebuild native modules against the bundled Node version ──────────────
# better-sqlite3 and node-pty ship Windows prebuilds for recent Node versions.
# We force the prebuild matching $NodeVersion so the bundle works even if the
# build host runs a different Node ABI.
if (-not $NoNodeRuntime) {
    Write-Step "Pinning native modules to Node $NodeVersion ABI"
    $env:npm_config_target = $NodeVersion
    $env:npm_config_runtime = 'node'
    $env:npm_config_target_arch = 'x64'
    $env:npm_config_target_platform = 'win32'
    Push-Location $projectRoot
    try {
        & pnpm rebuild better-sqlite3 node-pty 2>&1 | Tee-Object -Variable rebuildLog | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn2 'pnpm rebuild returned non-zero; continuing if prebuilds were applied.'
            $rebuildLog | ForEach-Object { Write-Host "    $_" }
        }
    } finally {
        Pop-Location
        Remove-Item Env:npm_config_target -ErrorAction SilentlyContinue
        Remove-Item Env:npm_config_runtime -ErrorAction SilentlyContinue
        Remove-Item Env:npm_config_target_arch -ErrorAction SilentlyContinue
        Remove-Item Env:npm_config_target_platform -ErrorAction SilentlyContinue
    }
} else {
    Write-Warn2 'Native modules will use whatever ABI was compiled during pnpm install.'
}

# ── 6. Stage everything ─────────────────────────────────────────────────────
Write-Step "Staging into $stageDir"
if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

# Copy app/
$stageApp = Join-Path $stageDir 'app'
Copy-Item -LiteralPath $standalone -Destination $stageApp -Recurse -Force

# Backfill peer/transitive prod deps the Next.js tracer missed (a known
# gap with pnpm's symlinked node_modules). We use `pnpm ls --prod` to walk
# only runtime deps and copy any that aren't already present.
$stageNodeModules = Join-Path $stageApp 'node_modules'
if (Test-Path -LiteralPath $stageNodeModules) {
    Write-Step 'Backfilling prod deps the Next.js tracer skipped'
    Push-Location $projectRoot
    try {
        $lsJson = & pnpm ls --prod --depth Infinity --json 2>$null
    } finally { Pop-Location }
    if (-not $lsJson) {
        Write-Warn2 'pnpm ls returned no output; skipping backfill (bundle may be incomplete)'
    } else {
        $lsTree = ($lsJson | Out-String) | ConvertFrom-Json

        $found = @{}  # name -> filesystem path
        function Walk-LsNode {
            param($Node)
            if (-not $Node.dependencies) { return }
            foreach ($member in ($Node.dependencies | Get-Member -MemberType NoteProperty)) {
                $name = $member.Name
                $entry = $Node.dependencies.$name
                if (-not $entry) { continue }
                if ($entry.path -and -not $script:found.ContainsKey($name)) {
                    $script:found[$name] = $entry.path
                }
                if (-not $entry.deduped) { Walk-LsNode -Node $entry }
            }
        }
        foreach ($root in @($lsTree)) { Walk-LsNode -Node $root }

        $copied = 0
        $skipped = 0
        foreach ($name in $found.Keys) {
            $src = $found[$name]
            if (-not (Test-Path -LiteralPath $src)) { continue }
            $dest = Join-Path $stageNodeModules ($name -replace '/', '\')
            if (Test-Path -LiteralPath $dest) { $skipped++; continue }
            $destParent = Split-Path -Parent $dest
            if (-not (Test-Path -LiteralPath $destParent)) {
                New-Item -ItemType Directory -Force -Path $destParent | Out-Null
            }
            Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
            $copied++
        }
        Write-Ok "pnpm backfill: $copied package(s) added, $skipped already present (out of $($found.Count) prod deps)"
    }
}

# Copy bundled Node (just the runtime files, not docs/changelog)
if (-not $NoNodeRuntime) {
    New-Item -ItemType Directory -Force -Path $nodeStage | Out-Null
    foreach ($file in 'node.exe', 'CHANGELOG.md', 'LICENSE') {
        $src = Join-Path $nodeExtract $file
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $nodeStage -Force
        }
    }
}

# Copy installer + helper scripts
foreach ($name in 'install.ps1', 'launcher.js', 'Start.bat', 'Stop.ps1', 'Uninstall.ps1', 'README.txt') {
    $src = Join-Path $packageSrc $name
    if (-not (Test-Path -LiteralPath $src)) { throw "Missing template: $src" }
    Copy-Item -LiteralPath $src -Destination $stageDir -Force
}

# Copy .env.example as a reference
$envExample = Join-Path $projectRoot '.env.example'
if (Test-Path -LiteralPath $envExample) {
    Copy-Item -LiteralPath $envExample -Destination (Join-Path $stageDir '.env.example') -Force
}

# Drop a small manifest so support can identify what's inside
$manifest = [ordered]@{
    name         = 'mission-control-windows'
    version      = $mcVersion
    nodeVersion  = if ($NoNodeRuntime) { 'system' } else { $NodeVersion }
    builtAt      = (Get-Date).ToString('o')
    builtOn      = $env:COMPUTERNAME
    targetArch   = 'win-x64'
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stageDir 'package.json') -Encoding utf8

# ── 6.4. Prune repo artifacts the tracer pulled into app/ ───────────────────
# Next.js's outputFileTracingRoot copies the entire project root, including
# many files that aren't needed at runtime (source, tests, wiki, docs,
# Docker assets, etc.). Trim them — the runtime only needs server.js,
# .next/, node_modules/, public/, messages/, and a handful of configs.
Write-Step 'Pruning repo artifacts from app/ (source, tests, docs, etc.)'
$appPruneDirs = @(
    'src', 'tests', 'wiki', 'docs', '.github', 'ops', 'skills', 'e2e',
    '.claude', '.husky', '.vscode', 'playwright-report', 'test-results'
)
$appPruneFiles = @(
    'CHANGELOG.md', 'CLAUDE.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md',
    'README.md', 'RELEASE.md', 'SECURITY.md', 'SKILL.md',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.hardened.yml',
    'docker-entrypoint.sh',
    'install.sh', 'install.ps1',
    'eslint.config.mjs', 'eslint.config.js', '.eslintrc.json',
    'playwright.config.ts', 'playwright.openclaw.gateway.config.ts',
    'playwright.openclaw.local.config.ts',
    'tailwind.config.ts', 'tailwind.config.js',
    'postcss.config.js', 'postcss.config.cjs',
    'tsconfig.json', 'tsconfig.build.json', 'next-env.d.ts',
    'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
    'vitest.config.ts', 'vitest.config.mjs',
    'openclaw_hardening_guide.md'
)
$appPrunedBytes = 0L
foreach ($d in $appPruneDirs) {
    $p = Join-Path $stageApp $d
    if (Test-Path -LiteralPath $p) {
        $sz = (Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
        Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
        if ($sz) { $appPrunedBytes += [int64]$sz }
    }
}
foreach ($f in $appPruneFiles) {
    $p = Join-Path $stageApp $f
    if (Test-Path -LiteralPath $p) {
        $sz = (Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue).Length
        Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
        if ($sz) { $appPrunedBytes += [int64]$sz }
    }
}
Write-Ok ("Pruned app/ repo artifacts ({0:N1} MB saved)" -f ($appPrunedBytes / 1MB))

# ── 6.5. Prune known-unused bloat from node_modules ─────────────────────────
Write-Step 'Pruning unused files from staged node_modules'
$pruneDirs = @('test', 'tests', '__tests__', 'spec', '__mocks__', 'example', 'examples', 'demo', 'demos', 'docs', 'doc', 'man', '.github', 'coverage', '.turbo', '.cache')
$pruneFilePatterns = @('*.md', '*.markdown', '*.map', '*.ts.map', '*.test.js', '*.spec.js', '*.test.cjs', '*.spec.cjs', '.npmignore', '.gitignore', '.eslintrc*', '.prettierrc*', '.travis.yml', '.editorconfig', 'tsconfig.json', 'tsconfig.*.json')

$prunedDirs = 0
$prunedFiles = 0
$prunedBytes = 0L

# Only prune inside node_modules — never touch app source.
Get-ChildItem -LiteralPath $stageNodeModules -Recurse -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $pruneDirs -contains $_.Name } |
    ForEach-Object {
        try {
            $size = (Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
            Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
            $script:prunedDirs++
            $script:prunedBytes += [int64]$size
        } catch {}
    }

foreach ($pattern in $pruneFilePatterns) {
    Get-ChildItem -LiteralPath $stageNodeModules -Recurse -File -Force -Filter $pattern -ErrorAction SilentlyContinue |
        ForEach-Object {
            try {
                $script:prunedBytes += $_.Length
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
                $script:prunedFiles++
            } catch {}
        }
}
Write-Ok ("Pruned $prunedDirs dirs and $prunedFiles files ({0:N1} MB saved)" -f ($prunedBytes / 1MB))

# ── 7. Sanity check the staged bundle ───────────────────────────────────────
$mustExist = @(
    'app\server.js'
    'app\.next\static'
    'launcher.js'
    'install.ps1'
    'Start.bat'
)
foreach ($rel in $mustExist) {
    $p = Join-Path $stageDir $rel
    if (-not (Test-Path -LiteralPath $p)) {
        throw "Bundle is missing $rel (expected at $p)"
    }
}
$bsq = Join-Path $stageDir 'app\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
if (-not (Test-Path -LiteralPath $bsq)) {
    Write-Warn2 "better-sqlite3 .node binary not found in standalone bundle (looked at $bsq). Standalone tracing may have skipped it; the target may need pnpm rebuild."
}
Write-Ok 'Staged bundle looks good'

# ── 8. Zip it up ────────────────────────────────────────────────────────────
$zipName = "mission-control-windows-$mcVersion.zip"
$zipPath = Join-Path $OutputDir $zipName
if ($NoZip) {
    Write-Ok "Skipping zip per -NoZip. Stage at: $stageDir"
    exit 0
}

Write-Step "Compressing -> $zipPath"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
$zipStart = Get-Date

# Prefer Windows' native bsdtar (System32\tar.exe) over .NET ZipFile or
# Compress-Archive: with ~1 GB of small files it finishes in ~30s vs 15+ min.
# bsdtar emits a real .zip via libarchive when --format=zip is given.
$bsdTar = Join-Path $env:WINDIR 'System32\tar.exe'
if (Test-Path -LiteralPath $bsdTar) {
    Push-Location $stageDir
    try {
        & $bsdTar -a -cf $zipPath --format=zip *
        if ($LASTEXITCODE -ne 0) { throw "bsdtar exited with $LASTEXITCODE" }
    } finally { Pop-Location }
} else {
    Write-Warn2 'System32\tar.exe missing; falling back to .NET ZipFile (slow on Windows).'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stageDir,
        $zipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )
}

$zipElapsed = (Get-Date) - $zipStart
Write-Ok ("Compression took {0:N0}s" -f $zipElapsed.TotalSeconds)

$zipBytes = (Get-Item -LiteralPath $zipPath).Length
$zipMB = [math]::Round($zipBytes / 1MB, 1)
Write-Ok "Built $zipName ($zipMB MB)"

Write-Host ''
Write-Host 'Next steps:'
Write-Host "  1. Copy $zipPath to the target Windows machine."
Write-Host '  2. Extract anywhere.'
Write-Host '  3. Right-click install.ps1 -> Run with PowerShell.'
