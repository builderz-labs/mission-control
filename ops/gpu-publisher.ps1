# Publishes host GPU info to $OPENCLAW_HOME\gpu.json every ~5 seconds so a
# containerized Mission Control can display GPU stats even when the container
# cannot access the host GPU directly. Run on the Windows host; the file is
# read through the read-only bind mount at /run/openclaw/gpu.json.
#
# Usage:   powershell -NoProfile -File gpu-publisher.ps1
# Interval (seconds) can be set via -Interval; default 5.

param(
  [int]$Interval = 5,
  [string]$OpenClawHome = "$env:USERPROFILE\.openclaw"
)

$ErrorActionPreference = 'Continue'
$outPath = Join-Path $OpenClawHome 'gpu.json'

function Get-GpuSnapshot {
  $gpus = @()

  # Prefer nvidia-smi for live memory usage when available.
  try {
    $smi = & nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0 -and $smi) {
      foreach ($line in ($smi -split "`n" | Where-Object { $_.Trim() })) {
        $parts = ($line -split ',') | ForEach-Object { $_.Trim() }
        if ($parts.Count -ge 3) {
          $total = [int]$parts[1]
          $used  = [int]$parts[2]
          $pct   = if ($total -gt 0) { [int](($used / $total) * 100) } else { 0 }
          $gpus += @{ name = $parts[0]; memoryTotalMB = $total; memoryUsedMB = $used; usagePercent = $pct }
        }
      }
    }
  } catch { }

  # Fall back to WMI for every other adapter (Intel, AMD, NVIDIA without driver tools).
  # Skip names already returned by nvidia-smi to avoid duplicates.
  $seen = @{}
  foreach ($g in $gpus) { $seen[$g.name] = $true }
  try {
    $adapters = Get-CimInstance Win32_VideoController -ErrorAction Stop
    foreach ($a in $adapters) {
      if ($seen.ContainsKey($a.Name)) { continue }
      $totalMB = if ($a.AdapterRAM) { [int]([math]::Round($a.AdapterRAM / 1MB)) } else { 0 }
      # WMI caps AdapterRAM at 4 GB on 32-bit types; anything >=4 GB reads as 4095.
      # Accept the value regardless — panel still renders the name.
      $gpus += @{ name = $a.Name; memoryTotalMB = $totalMB; memoryUsedMB = 0; usagePercent = 0 }
    }
  } catch { }

  return $gpus
}

function Write-Snapshot {
  $snapshot = @{
    updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    source    = 'host-publisher/windows'
    gpus      = Get-GpuSnapshot
  }
  $json = $snapshot | ConvertTo-Json -Depth 4 -Compress
  # Atomic replace: write to .tmp then Move-Item.
  $tmp = "$outPath.tmp"
  try {
    if (-not (Test-Path $OpenClawHome)) { New-Item -ItemType Directory -Path $OpenClawHome -Force | Out-Null }
    [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Path $tmp -Destination $outPath -Force
  } catch {
    # best-effort; next tick will retry
  }
}

while ($true) {
  Write-Snapshot
  Start-Sleep -Seconds $Interval
}
