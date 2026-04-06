// ---------------------------------------------------------------------------
// Linux-specific OS hardening checks
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs'
import { type Check } from './types'
import { cachedExec, tryExec, tryExecBatch } from './exec-helpers'

export function addLinuxHardeningChecks(checks: Check[]): void {
  addKernelParamChecks(checks)
  addMacFrameworkCheck(checks)
  addFail2banCheck(checks)
  addTmpNoexecCheck(checks)
  addSshHardeningChecks(checks)
  addAutoUpdateCheck(checks)
  addLuksDiskEncryptionCheck(checks)
}

function addLuksDiskEncryptionCheck(checks: Check[]): void {
  const luksDevices = tryExec('lsblk -o TYPE 2>/dev/null | grep -c crypt')
  const hasCrypt = luksDevices ? parseInt(luksDevices, 10) > 0 : false
  checks.push({
    id: 'disk_encryption',
    name: 'Disk encryption (LUKS)',
    status: hasCrypt ? 'pass' : 'warn',
    detail: hasCrypt ? 'Encrypted volumes detected' : 'No LUKS-encrypted volumes detected',
    fix: !hasCrypt ? 'Consider encrypting data volumes with LUKS' : '',
    severity: 'high',
    platform: 'linux',
  })
}

function addKernelParamChecks(checks: Check[]): void {
  const kernelParams = tryExecBatch(
    'echo "aslr=$(cat /proc/sys/kernel/randomize_va_space 2>/dev/null)"; ' +
    'echo "core_pattern=$(cat /proc/sys/kernel/core_pattern 2>/dev/null)"; ' +
    'echo "syn_cookies=$(cat /proc/sys/net/ipv4/tcp_syncookies 2>/dev/null)"'
  )

  const aslr = kernelParams['aslr']
  checks.push({
    id: 'linux_aslr',
    name: 'Kernel ASLR enabled',
    status: aslr === '2' ? 'pass' : aslr === '1' ? 'warn' : 'fail',
    detail: aslr === '2'
      ? 'Full ASLR randomization active'
      : aslr === '1'
        ? 'Partial ASLR — upgrade to full'
        : aslr ? `ASLR value: ${aslr}` : 'Could not read ASLR status',
    fix: aslr !== '2' ? 'Set: sysctl -w kernel.randomize_va_space=2' : '',
    severity: 'critical',
    fixSafety: 'manual-only',
    platform: 'linux',
  })

  const corePattern = kernelParams['core_pattern'] || ''
  const coreToFile = !corePattern.startsWith('|') && corePattern !== ''
  checks.push({
    id: 'linux_core_dumps',
    name: 'Core dumps restricted',
    status: coreToFile ? 'warn' : 'pass',
    detail: coreToFile
      ? `Core pattern writes to file: ${corePattern}`
      : 'Core dumps piped to handler or disabled',
    fix: coreToFile ? 'Restrict core dumps: echo "|/bin/false" > /proc/sys/kernel/core_pattern' : '',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'linux',
  })

  const synCookies = kernelParams['syn_cookies']
  checks.push({
    id: 'linux_syn_cookies',
    name: 'TCP SYN cookies enabled',
    status: synCookies === '1' ? 'pass' : 'warn',
    detail: synCookies === '1' ? 'SYN cookie protection active' : 'SYN cookies are not enabled',
    fix: synCookies !== '1' ? 'Set: sysctl -w net.ipv4.tcp_syncookies=1' : '',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'linux',
  })
}

function addMacFrameworkCheck(checks: Check[]): void {
  const selinux = cachedExec('selinux', 'cat /sys/fs/selinux/enforce 2>/dev/null')
  const apparmor = cachedExec('apparmor', 'aa-status --enabled 2>/dev/null; echo $?')
  const hasSELinux = selinux === '1'
  const hasAppArmor = apparmor?.trim().endsWith('0')
  checks.push({
    id: 'linux_mac_framework',
    name: 'Mandatory access control',
    status: hasSELinux || hasAppArmor ? 'pass' : 'warn',
    detail: hasSELinux ? 'SELinux enforcing' : hasAppArmor ? 'AppArmor active' : 'No MAC framework detected',
    fix: !hasSELinux && !hasAppArmor ? 'Enable AppArmor or SELinux for mandatory access control' : '',
    severity: 'high',
    fixSafety: 'manual-only',
    platform: 'linux',
  })
}

function addFail2banCheck(checks: Check[]): void {
  const f2bStatus = cachedExec('fail2ban', 'systemctl is-active fail2ban 2>/dev/null')
  checks.push({
    id: 'linux_fail2ban',
    name: 'Brute-force protection (fail2ban)',
    status: f2bStatus === 'active' ? 'pass' : 'warn',
    detail: f2bStatus === 'active' ? 'fail2ban is active' : 'fail2ban is not running',
    fix: f2bStatus !== 'active'
      ? 'Install and enable fail2ban: sudo apt install fail2ban && sudo systemctl enable --now fail2ban'
      : '',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'linux',
  })
}

function addTmpNoexecCheck(checks: Check[]): void {
  const tmpMount = cachedExec('tmp_mount', 'mount 2>/dev/null | grep " /tmp "')
  const tmpNoexec = tmpMount?.includes('noexec')
  checks.push({
    id: 'linux_tmp_noexec',
    name: '/tmp mounted noexec',
    status: tmpNoexec ? 'pass' : 'warn',
    detail: tmpNoexec ? '/tmp is mounted with noexec' : '/tmp may allow execution — consider noexec mount',
    fix: !tmpNoexec ? 'Add noexec,nosuid,nodev to /tmp mount options in /etc/fstab' : '',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'linux',
  })
}

function addSshHardeningChecks(checks: Check[]): void {
  if (!existsSync('/etc/ssh/sshd_config')) return

  const sshdConfig = tryExec('grep -i "^PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null')
  if (sshdConfig !== null) {
    const allowsRoot = sshdConfig.toLowerCase().includes('yes')
    checks.push({
      id: 'ssh_root',
      name: 'SSH root login disabled',
      status: allowsRoot ? 'fail' : 'pass',
      detail: allowsRoot ? 'SSH allows root login' : 'SSH root login is restricted',
      fix: allowsRoot ? 'Set PermitRootLogin no in /etc/ssh/sshd_config and restart sshd' : '',
      severity: 'critical',
      platform: 'linux',
    })
  }

  const sshPwAuth = tryExec('grep -i "^PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null')
  if (sshPwAuth !== null) {
    const allowsPw = sshPwAuth.toLowerCase().includes('yes')
    checks.push({
      id: 'ssh_password',
      name: 'SSH password auth disabled',
      status: allowsPw ? 'warn' : 'pass',
      detail: allowsPw ? 'SSH allows password authentication' : 'SSH uses key-based authentication only',
      fix: allowsPw ? 'Set PasswordAuthentication no in /etc/ssh/sshd_config' : '',
      severity: 'high',
      platform: 'linux',
    })
  }
}

function addAutoUpdateCheck(checks: Check[]): void {
  const hasUnattended =
    existsSync('/etc/apt/apt.conf.d/20auto-upgrades') ||
    existsSync('/etc/yum/yum-cron.conf') ||
    existsSync('/etc/dnf/automatic.conf')
  checks.push({
    id: 'auto_updates',
    name: 'Automatic security updates',
    status: hasUnattended ? 'pass' : 'warn',
    detail: hasUnattended
      ? 'Automatic update configuration found'
      : 'No automatic update configuration detected',
    fix: !hasUnattended
      ? 'Install unattended-upgrades (Debian/Ubuntu) or dnf-automatic (RHEL/Fedora)'
      : '',
    severity: 'medium',
    platform: 'linux',
  })
}
