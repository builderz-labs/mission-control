import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupDeleteSchema } from '@/lib/validation'

describe('backup administration security boundary', () => {
  it.each(['backup.db', 'mc-backup-2026-07-16.db'])('accepts a local database backup name: %s', (name) => {
    expect(backupDeleteSchema.safeParse({ name }).success).toBe(true)
  })

  it.each([
    '../backup.db',
    'folder/backup.db',
    'folder\\backup.db',
    'backup.sqlite',
    'backup.db.extra',
  ])('rejects an unsafe backup name: %s', (name) => {
    expect(backupDeleteSchema.safeParse({ name }).success).toBe(false)
  })

  it('rejects extra deletion fields', () => {
    expect(backupDeleteSchema.safeParse({ name: 'backup.db', path: '/tmp/backup.db' }).success).toBe(false)
  })

  it('uses critical identity throttling and non-sensitive responses', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/backup/route.ts'), 'utf8')

    expect(source.match(/backupMutationLimiter\(limitKey\)/g)).toHaveLength(2)
    expect(source).not.toContain('heavyLimiter(request)')
    expect(source).not.toContain('dir: BACKUP_DIR')
    expect(source).not.toContain('detail: { path: backupPath')
    expect(source).not.toContain('Gateway backup failed: ${')
    expect(source).not.toContain('Backup failed: ${')
    expect(source).toContain("target !== null && target !== 'gateway'")
    expect(source).toContain('extractClientIp(request)')
    expect(source).toContain("{ error: 'Request body required' }")
  })

  it('defines the backup limiter as critical', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8')
    const definition = source.slice(
      source.indexOf('export const backupMutationLimiter'),
      source.indexOf('/** User lifecycle'),
    )

    expect(definition).toContain('createKeyedRateLimiter')
    expect(definition).toContain('critical: true')
    expect(definition).toContain('maxRequests: 10')
  })
})
