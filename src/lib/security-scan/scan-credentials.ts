// ---------------------------------------------------------------------------
// Credentials scanner — checks AUTH_PASS, API_KEY, and .env file permissions
// ---------------------------------------------------------------------------

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { type Category, type Check, INSECURE_PASSWORDS } from './types'
import { scoreCategory } from './report'

export function scanCredentials(): Category {
  const checks: Check[] = []

  const authPass = process.env.AUTH_PASS || ''
  if (!authPass) {
    checks.push({
      id: 'auth_pass',
      name: 'Admin password configured',
      status: 'fail',
      detail: 'AUTH_PASS is not configured',
      fix: 'Set AUTH_PASS in .env to a strong password (12+ characters)',
      severity: 'critical',
    })
  } else if (INSECURE_PASSWORDS.has(authPass)) {
    checks.push({
      id: 'auth_pass',
      name: 'Admin password strength',
      status: 'fail',
      detail: 'AUTH_PASS is set to a known insecure default',
      fix: 'Change AUTH_PASS to a unique password with 12+ characters',
      severity: 'critical',
    })
  } else if (authPass.length < 12) {
    checks.push({
      id: 'auth_pass',
      name: 'Admin password strength',
      status: 'warn',
      detail: `AUTH_PASS is only ${authPass.length} characters`,
      fix: 'Use a password with at least 12 characters',
      severity: 'critical',
    })
  } else {
    checks.push({
      id: 'auth_pass',
      name: 'Admin password strength',
      status: 'pass',
      detail: 'AUTH_PASS is a strong, non-default password',
      fix: '',
      severity: 'critical',
    })
  }

  const apiKey = process.env.API_KEY || ''
  checks.push({
    id: 'api_key_set',
    name: 'API key configured',
    status: apiKey && apiKey !== 'generate-a-random-key' ? 'pass' : 'fail',
    detail: !apiKey
      ? 'API_KEY is not set'
      : apiKey === 'generate-a-random-key'
        ? 'API_KEY uses the default placeholder'
        : 'API_KEY is configured',
    fix: !apiKey || apiKey === 'generate-a-random-key'
      ? 'Run: bash scripts/generate-env.sh --force'
      : '',
    severity: 'critical',
  })

  const envPath = path.join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    try {
      const stat = statSync(envPath)
      const mode = (stat.mode & 0o777).toString(8)
      checks.push({
        id: 'env_permissions',
        name: '.env file permissions',
        status: mode === '600' ? 'pass' : 'warn',
        detail: `.env permissions are ${mode}`,
        fix: mode !== '600' ? 'Run: chmod 600 .env' : '',
        severity: 'medium',
        fixSafety: 'safe',
      })
    } catch {
      checks.push({
        id: 'env_permissions',
        name: '.env file permissions',
        status: 'warn',
        detail: 'Could not check .env permissions',
        fix: 'Run: chmod 600 .env',
        severity: 'medium',
        fixSafety: 'safe',
      })
    }
  }

  return scoreCategory(checks)
}
