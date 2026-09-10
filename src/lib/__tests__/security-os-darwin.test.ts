import { describe, expect, it } from 'vitest'
import {
  darwinAutoUpdatesCheck,
  darwinFirewallCheck,
  darwinListenPortsCheck,
  darwinNtpCheck,
  darwinRemoteLoginCheck,
  darwinStealthCheck,
  publicListenPorts,
} from '@/lib/security-os-darwin'

const NETSTAT = `
tcp4       0      0  127.0.0.1.3000         *.*                    LISTEN
tcp4       0      0  127.0.0.1.18789        *.*                    LISTEN
tcp6       0      0  ::1.18789              *.*                    LISTEN
tcp4       0      0  *.22                   *.*                    LISTEN
tcp6       0      0  *.22                   *.*                    LISTEN
tcp4       0      0  *.5900                 *.*                    LISTEN
`

describe('publicListenPorts', () => {
  it('ignores loopback and dedupes ipv4/ipv6', () => {
    expect(publicListenPorts(NETSTAT)).toEqual([22, 5900])
  })
})

describe('darwin checks', () => {
  it('passes NTP from sntp offset without systemsetup', () => {
    const check = darwinNtpCheck((cmd) => {
      if (cmd.includes('sntp')) return '+0.058160 +/- 0.045677 time.apple.com'
      return null
    })
    expect(check.status).toBe('pass')
  })

  it('passes auto-updates from AutomaticDownload', () => {
    const check = darwinAutoUpdatesCheck((cmd) => {
      if (cmd.includes('AutomaticDownload')) return '1'
      return null
    })
    expect(check.status).toBe('pass')
  })

  it('counts only public listen ports', () => {
    const check = darwinListenPortsCheck(() => NETSTAT)
    expect(check.status).toBe('pass')
    expect(check.detail).toContain('22')
    expect(check.detail).not.toContain('3000')
  })

  it('treats stealth mode "is on" as enabled', () => {
    expect(darwinStealthCheck(() => 'Firewall stealth mode is on').status).toBe('pass')
    expect(darwinStealthCheck(() => 'Firewall stealth mode is off').status).toBe('warn')
  })

  it('treats firewall "is enabled" as on', () => {
    expect(darwinFirewallCheck(() => 'Firewall is enabled. (State = 1)').status).toBe('pass')
    expect(darwinFirewallCheck(() => 'Firewall is disabled. (State = 0)').status).toBe('warn')
  })

  it('treats sshd not running without port 22 as disabled', () => {
    const check = darwinRemoteLoginCheck((cmd) => {
      if (cmd.includes('launchctl')) return 'state = not running\nactive count = 0'
      if (cmd.includes('netstat')) return 'tcp4 0 0 127.0.0.1.3000 *.* LISTEN\n'
      return null
    })
    expect(check.status).toBe('pass')
  })

  it('warns when port 22 is public even if sshd is idle', () => {
    const check = darwinRemoteLoginCheck((cmd) => {
      if (cmd.includes('launchctl')) return 'state = not running\nactive count = 0'
      if (cmd.includes('netstat')) return NETSTAT
      return null
    })
    expect(check.status).toBe('warn')
    expect(check.detail).toContain('enabled')
  })
})
