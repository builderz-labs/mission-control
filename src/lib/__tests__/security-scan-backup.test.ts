import { describe, expect, it } from 'vitest'
import { buildBackupCheck } from '@/lib/security-scan'

const schedulerRunning = {
  enabled: true,
  schedulerRegistered: true,
  schedulerLastRun: Date.now() - 86_400_000,
}

describe('buildBackupCheck', () => {
  it('does not tell the user to enable auto_backup when it is already enabled', () => {
    const check = buildBackupCheck(61, {
      enabled: true,
      schedulerRegistered: false,
      schedulerLastRun: null,
    })

    expect(check.status).toBe('warn')
    expect(check.detail).toContain('auto_backup is enabled')
    expect(check.detail).toContain('scheduler is not running')
    expect(check.fix).not.toContain('Enable auto_backup')
  })

  it('identifies a disabled automatic backup setting', () => {
    const check = buildBackupCheck(null, {
      enabled: false,
      schedulerRegistered: true,
      schedulerLastRun: null,
    })

    expect(check.detail).toBe('No backups found; automatic backups are disabled')
    expect(check.fix).toContain('Enable auto_backup')
  })

  it('passes when a recent backup exists', () => {
    const check = buildBackupCheck(2, schedulerRunning)

    expect(check.status).toBe('pass')
    expect(check.fix).toBe('')
  })

  it('reports a failed scheduled run instead of blaming the setting', () => {
    const check = buildBackupCheck(30, {
      ...schedulerRunning,
      schedulerLastResult: { ok: false, message: 'Backup failed' },
    })

    expect(check.detail).toContain('last scheduled run failed: Backup failed')
    expect(check.fix).not.toContain('Enable auto_backup')
  })
})
