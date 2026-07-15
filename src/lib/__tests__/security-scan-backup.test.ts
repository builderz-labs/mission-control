import { describe, expect, it } from 'vitest'
import { buildBackupCheck } from '@/lib/security-scan'

const schedulerRunning = {
  enabled: true,
  schedulerRegistered: true,
  schedulerLastRun: Date.now() - 86_400_000,
}

describe('buildBackupCheck', () => {
  it('passes when a recent backup exists', () => {
    const check = buildBackupCheck(2, schedulerRunning)

    expect(check.status).toBe('pass')
    expect(check.fix).toBe('')
  })

  it('does not claim automatic backups are disabled when they are enabled', () => {
    const check = buildBackupCheck(61, {
      enabled: true,
      schedulerRegistered: false,
      schedulerLastRun: null,
    })

    expect(check.status).toBe('warn')
    expect(check.detail).toContain('automatic backups are enabled')
    expect(check.detail).toContain('scheduler is not running')
    expect(check.fix).not.toContain('Enable automatic backups')
  })

  it('identifies a disabled automatic backup setting', () => {
    const check = buildBackupCheck(null, {
      enabled: false,
      schedulerRegistered: true,
      schedulerLastRun: null,
    })

    expect(check.detail).toBe('No backups found; automatic backups are disabled')
    expect(check.fix).toContain('Enable automatic backups')
  })

  it('does not turn an unreadable setting into a disabled claim', () => {
    const check = buildBackupCheck(null, {
      enabled: null,
      schedulerRegistered: false,
      schedulerLastRun: null,
    })

    expect(check.detail).toContain('status could not be read')
    expect(check.detail).not.toContain('disabled')
  })

  it('reports a failed scheduled run without exposing its raw error', () => {
    const check = buildBackupCheck(30, {
      ...schedulerRunning,
      schedulerLastResult: { ok: false, message: 'secret=/private/path' },
    })

    expect(check.detail).toContain('last scheduled backup failed')
    expect(check.detail).not.toContain('secret')
    expect(check.fix).not.toContain('curl')
  })

  it('marks a week-old backup as failed', () => {
    expect(buildBackupCheck(168, schedulerRunning).status).toBe('fail')
  })
})
