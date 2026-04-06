// ---------------------------------------------------------------------------
// Runtime scanner — injection guard, rate limiting, backups, DB integrity
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { type Category, type Check } from './types'
import { scoreCategory } from './report'

export function scanRuntime(): Category {
  const checks: Check[] = []

  addInjectionGuardCheck(checks)
  addRateLimitCheck(checks)
  addDockerCheck(checks)
  addBackupCheck(checks)
  addDbIntegrityCheck(checks)

  return scoreCategory(checks)
}

function addInjectionGuardCheck(checks: Check[]): void {
  try {
    require('@/lib/injection-guard')
    checks.push({
      id: 'injection_guard',
      name: 'Injection guard active',
      status: 'pass',
      detail: 'Prompt and command injection protection is loaded',
      fix: '',
      severity: 'critical',
    })
  } catch {
    checks.push({
      id: 'injection_guard',
      name: 'Injection guard active',
      status: 'fail',
      detail: 'Injection guard module not found',
      fix: 'Ensure src/lib/injection-guard.ts exists and is importable',
      severity: 'critical',
    })
  }
}

function addRateLimitCheck(checks: Check[]): void {
  const rlDisabled = process.env.MC_DISABLE_RATE_LIMIT
  checks.push({
    id: 'rate_limiting',
    name: 'Rate limiting active',
    status: !rlDisabled ? 'pass' : 'fail',
    detail: rlDisabled ? 'Rate limiting is disabled' : 'Rate limiting is active',
    fix: rlDisabled ? 'Remove MC_DISABLE_RATE_LIMIT from .env' : '',
    severity: 'high',
  })
}

function addDockerCheck(checks: Check[]): void {
  const isDocker = existsSync('/.dockerenv')
  if (isDocker) {
    checks.push({
      id: 'docker_detected',
      name: 'Running in Docker',
      status: 'pass',
      detail: 'Container environment detected',
      fix: '',
      severity: 'low',
    })
  }
}

function addBackupCheck(checks: Check[]): void {
  try {
    const backupDir = path.join(path.dirname(config.dbPath), 'backups')
    if (!existsSync(backupDir)) {
      checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backup directory', fix: 'Enable auto_backup in Settings', severity: 'medium' })
      return
    }

    const files = readdirSync(backupDir)
      .filter((f: string) => f.endsWith('.db'))
      .map((f: string) => ({ mtime: statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length === 0) {
      checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backups found', fix: 'Enable auto_backup in Settings', severity: 'medium' })
      return
    }

    const ageHours = Math.round((Date.now() - files[0].mtime) / 3600000)
    checks.push({
      id: 'backup_recent',
      name: 'Recent backup exists',
      status: ageHours < 24 ? 'pass' : ageHours < 168 ? 'warn' : 'fail',
      detail: `Latest backup is ${ageHours}h old`,
      fix: ageHours >= 24 ? 'Enable auto_backup in Settings or run: curl -X POST /api/backup' : '',
      severity: 'medium',
    })
  } catch {
    checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'Could not check backups', fix: '', severity: 'medium' })
  }
}

function addDbIntegrityCheck(checks: Check[]): void {
  try {
    const db = getDatabase()
    const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined
    checks.push({
      id: 'db_integrity',
      name: 'Database integrity',
      status: result?.integrity_check === 'ok' ? 'pass' : 'fail',
      detail: result?.integrity_check === 'ok'
        ? 'Integrity check passed'
        : `Integrity: ${result?.integrity_check || 'unknown'}`,
      fix: result?.integrity_check !== 'ok' ? 'Database may be corrupted — restore from backup' : '',
      severity: 'critical',
    })
  } catch {
    checks.push({ id: 'db_integrity', name: 'Database integrity', status: 'warn', detail: 'Could not run integrity check', fix: '', severity: 'critical' })
  }
}
