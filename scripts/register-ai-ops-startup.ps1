param(
  [string]$TaskName = 'AI Ops Hub'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot 'start-ai-ops-hub.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Starts the local AI Ops Hub server and background runner at Windows logon.' -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "It will start on the next Windows logon. Run scripts\start-ai-ops-hub.ps1 to start it now."
