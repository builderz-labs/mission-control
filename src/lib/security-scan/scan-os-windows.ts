// ---------------------------------------------------------------------------
// Windows-specific OS hardening checks
// ---------------------------------------------------------------------------

import { type Check } from './types'
import { cachedExec } from './exec-helpers'

export function addWindowsHardeningChecks(checks: Check[]): void {
  addDefenderCheck(checks)
  addFirewallCheck(checks)
  addBitLockerCheck(checks)
  addUacCheck(checks)
  addRdpCheck(checks)
  addSmb1Check(checks)
}

function addDefenderCheck(checks: Check[]): void {
  const status = cachedExec('win_defender', 'powershell -NoProfile -Command "(Get-MpComputerStatus).RealTimeProtectionEnabled" 2>nul')
  checks.push({
    id: 'win_defender',
    name: 'Windows Defender active',
    status: status === 'True' ? 'pass' : 'fail',
    detail: status === 'True'
      ? 'Real-time protection is enabled'
      : 'Windows Defender real-time protection is not active',
    fix: status !== 'True' ? 'Enable Windows Defender real-time protection in Windows Security settings' : '',
    severity: 'critical',
    fixSafety: 'manual-only',
    platform: 'win32',
  })
}

function addFirewallCheck(checks: Check[]): void {
  const profiles = cachedExec('win_firewall', 'powershell -NoProfile -Command "(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $true}).Count" 2>nul')
  const count = profiles ? parseInt(profiles, 10) : 0
  checks.push({
    id: 'win_firewall',
    name: 'Windows Firewall active',
    status: count >= 3 ? 'pass' : count > 0 ? 'warn' : 'fail',
    detail: count >= 3 ? 'All firewall profiles are active' : `${count} of 3 firewall profiles active`,
    fix: count < 3 ? 'Enable all firewall profiles in Windows Defender Firewall settings' : '',
    severity: 'critical',
    fixSafety: 'manual-only',
    platform: 'win32',
  })
}

function addBitLockerCheck(checks: Check[]): void {
  const bitlocker = cachedExec('win_bitlocker', 'powershell -NoProfile -Command "(Get-BitLockerVolume -MountPoint C:).ProtectionStatus" 2>nul')
  checks.push({
    id: 'win_bitlocker',
    name: 'BitLocker encryption',
    status: bitlocker === 'On' ? 'pass' : 'warn',
    detail: bitlocker === 'On' ? 'BitLocker is active on C:' : 'BitLocker is not active on C:',
    fix: bitlocker !== 'On' ? 'Enable BitLocker in Control Panel > BitLocker Drive Encryption' : '',
    severity: 'high',
    fixSafety: 'manual-only',
    platform: 'win32',
  })
}

function addUacCheck(checks: Check[]): void {
  const uac = cachedExec('win_uac', 'powershell -NoProfile -Command "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System).EnableLUA" 2>nul')
  checks.push({
    id: 'win_uac',
    name: 'UAC enabled',
    status: uac === '1' ? 'pass' : 'fail',
    detail: uac === '1' ? 'User Account Control is enabled' : 'UAC is disabled',
    fix: uac !== '1' ? 'Enable UAC in Control Panel > User Account Control Settings' : '',
    severity: 'high',
    fixSafety: 'manual-only',
    platform: 'win32',
  })
}

function addRdpCheck(checks: Check[]): void {
  const rdp = cachedExec('win_rdp', "powershell -NoProfile -Command \"(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections\" 2>nul")
  checks.push({
    id: 'win_rdp_disabled',
    name: 'Remote Desktop disabled',
    status: rdp === '1' ? 'pass' : 'warn',
    detail: rdp === '1' ? 'Remote Desktop is disabled' : 'Remote Desktop is enabled',
    fix: rdp !== '1' ? 'Disable RDP if not needed: System Properties > Remote > disable Remote Desktop' : '',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'win32',
  })
}

function addSmb1Check(checks: Check[]): void {
  const smb1 = cachedExec('win_smb1', 'powershell -NoProfile -Command "(Get-SmbServerConfiguration).EnableSMB1Protocol" 2>nul')
  checks.push({
    id: 'win_smb1_disabled',
    name: 'SMBv1 disabled',
    status: smb1 === 'False' ? 'pass' : 'warn',
    detail: smb1 === 'False' ? 'SMBv1 is disabled' : 'SMBv1 may be enabled',
    fix: smb1 !== 'False' ? 'Disable: Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force' : '',
    severity: 'high',
    fixSafety: 'manual-only',
    platform: 'win32',
  })
}
