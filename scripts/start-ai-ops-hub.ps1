param([switch]$Dev)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $Root '.data\ai-ops-logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
Set-Location $Root

$envFile = Join-Path $Root '.env.aiops.local.ps1'
if (Test-Path $envFile) { . $envFile }

function Test-LocalPort([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $result.AsyncWaitHandle.WaitOne(250)
    if ($ok -and $client.Connected) {
      $client.EndConnect($result)
      $client.Close()
      return $true
    }
    $client.Close()
  } catch {}
  return $false
}

if (-not (Test-LocalPort 3000)) {
  $serverLog = Join-Path $Logs 'server.log'
  $serverErr = Join-Path $Logs 'server.err.log'
  $command = if ($Dev) { 'pnpm.cmd aiops:dev' } else { 'pnpm.cmd aiops:start' }
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c',$command -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not (Test-LocalPort 3000)) {
    Start-Sleep -Milliseconds 500
  }
}

$bootstrapLog = Join-Path $Logs 'bootstrap.log'
$bootstrapErr = Join-Path $Logs 'bootstrap.err.log'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','pnpm.cmd aiops:bootstrap' -WorkingDirectory $Root -WindowStyle Hidden -Wait -RedirectStandardOutput $bootstrapLog -RedirectStandardError $bootstrapErr

$syncLog = Join-Path $Logs 'shufuro-sync.log'
$syncErr = Join-Path $Logs 'shufuro-sync.err.log'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','pnpm.cmd aiops:sync:shufuro' -WorkingDirectory $Root -WindowStyle Hidden -Wait -RedirectStandardOutput $syncLog -RedirectStandardError $syncErr

$runnerExists = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like '*ai-ops-runner.mjs*'
} | Select-Object -First 1

if (-not $runnerExists) {
  $runnerLog = Join-Path $Logs 'runner.log'
  $runnerErr = Join-Path $Logs 'runner.err.log'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','pnpm.cmd aiops:runner' -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $runnerLog -RedirectStandardError $runnerErr
}

Write-Host 'AI Ops Hub background services started.'
