// ---------------------------------------------------------------------------
// macOS-specific OS hardening checks
// ---------------------------------------------------------------------------

import { type Check } from './types'
import { cachedExec, tryExec } from './exec-helpers'

export function addDarwinHardeningChecks(checks: Check[]): void {
  addSipCheck(checks)
  addGatekeeperCheck(checks)
  addStealthModeCheck(checks)
  addRemoteLoginCheck(checks)
  addGuestAccountCheck(checks)
  addFileVaultCheck(checks)
  addAutoUpdateCheck(checks)
  addNtpCheck(checks)
}

function addSipCheck(checks: Check[]): void {
  const sipStatus = cachedExec('sip', 'csrutil status 2>/dev/null')
  const sipEnabled = sipStatus?.toLowerCase().includes('enabled')
  checks.push({
    id: 'macos_sip',
    name: 'System Integrity Protection',
    status: sipEnabled ? 'pass' : 'fail',
    detail: sipEnabled ? 'SIP is enabled' : 'SIP is disabled — system files are unprotected',
    fix: !sipEnabled ? 'Re-enable SIP from Recovery Mode: csrutil enable' : '',
    severity: 'critical',
    fixSafety: 'manual-only',
    platform: 'darwin',
  })
}

function addGatekeeperCheck(checks: Check[]): void {
  const gkStatus = cachedExec('gatekeeper', 'spctl --status 2>/dev/null')
  const gkEnabled = gkStatus?.includes('enabled')
  checks.push({
    id: 'macos_gatekeeper',
    name: 'Gatekeeper active',
    status: gkEnabled ? 'pass' : 'warn',
    detail: gkEnabled ? 'Gatekeeper is enabled' : 'Gatekeeper is disabled',
    fix: !gkEnabled ? 'Enable Gatekeeper: sudo spctl --master-enable' : '',
    severity: 'high',
    fixSafety: 'manual-only',
    platform: 'darwin',
  })
}

function addStealthModeCheck(checks: Check[]): void {
  const stealthStatus = cachedExec('stealth', '/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null')
  const stealthEnabled = stealthStatus?.includes('enabled')
  checks.push({
    id: 'macos_stealth_mode',
    name: 'Firewall stealth mode',
    status: stealthEnabled ? 'pass' : 'warn',
    detail: stealthEnabled ? 'Stealth mode is enabled' : 'Stealth mode is disabled',
    fix: !stealthEnabled
      ? 'Enable: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on'
      : '',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'darwin',
  })
}

function addRemoteLoginCheck(checks: Check[]): void {
  const remoteLogin = cachedExec('remote_login', 'systemsetup -getremotelogin 2>/dev/null')
  const remoteOff = remoteLogin?.toLowerCase().includes('off')
  checks.push({
    id: 'macos_remote_login',
    name: 'Remote login disabled',
    status: remoteOff ? 'pass' : 'warn',
    detail: remoteOff ? 'Remote login (SSH) is disabled' : 'Remote login (SSH) is enabled',
    fix: !remoteOff ? 'Disable if not needed: sudo systemsetup -setremotelogin off' : '',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'darwin',
  })
}

function addGuestAccountCheck(checks: Check[]): void {
  const guestAccount = cachedExec('guest', 'defaults read /Library/Preferences/com.apple.loginwindow GuestEnabled 2>/dev/null')
  const guestDisabled = guestAccount === '0'
  checks.push({
    id: 'macos_guest_account',
    name: 'Guest account disabled',
    status: guestDisabled || guestAccount === null ? 'pass' : 'warn',
    detail: guestDisabled || guestAccount === null ? 'Guest account is disabled' : 'Guest account is enabled',
    fix: !guestDisabled && guestAccount !== null
      ? 'Disable: sudo defaults write /Library/Preferences/com.apple.loginwindow GuestEnabled -bool false'
      : '',
    severity: 'low',
    fixSafety: 'manual-only',
    platform: 'darwin',
  })
}

function addFileVaultCheck(checks: Check[]): void {
  const fvStatus = tryExec('fdesetup status 2>/dev/null')
  const encrypted = fvStatus?.includes('On')
  checks.push({
    id: 'disk_encryption',
    name: 'Disk encryption (FileVault)',
    status: encrypted ? 'pass' : 'fail',
    detail: encrypted ? 'FileVault is enabled' : 'FileVault is not enabled',
    fix: !encrypted ? 'Enable FileVault in System Settings > Privacy & Security' : '',
    severity: 'high',
    platform: 'darwin',
  })
}

function addAutoUpdateCheck(checks: Check[]): void {
  const autoUpdate = tryExec('defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled 2>/dev/null')
  checks.push({
    id: 'auto_updates',
    name: 'Automatic software updates',
    status: autoUpdate === '1' ? 'pass' : 'warn',
    detail: autoUpdate === '1' ? 'Automatic update checks enabled' : 'Automatic update status unknown',
    fix: autoUpdate !== '1' ? 'Enable in System Settings > General > Software Update' : '',
    severity: 'medium',
    platform: 'darwin',
  })
}

function addNtpCheck(checks: Check[]): void {
  const ntpStatus = cachedExec('ntp_sync', 'systemsetup -getusingnetworktime 2>/dev/null')
  const ntpActive = ntpStatus?.toLowerCase().includes('on')
  checks.push({
    id: 'ntp_sync',
    name: 'Time synchronization',
    status: ntpActive ? 'pass' : 'warn',
    detail: ntpActive ? 'Network time is enabled' : 'Network time may be disabled',
    fix: !ntpActive ? 'Enable: sudo systemsetup -setusingnetworktime on' : '',
    severity: 'low',
    platform: 'darwin',
  })
}
