import Database from 'better-sqlite3';
import { hashPassword } from '../password';
import { logger } from '../logger';
import type { CountRow } from './types';

// Known-insecure passwords that should never be used in production.
// Includes the .env.example default and common placeholder values.
const INSECURE_PASSWORDS = new Set([
  'admin',
  'password',
  'change-me-on-first-login',
  'changeme',
  'testpass123',
])

/**
 * Resolves the admin seed password from environment variables.
 * Prefers AUTH_PASS_B64 (base64-encoded) over plain AUTH_PASS for
 * deployments where the password contains special shell characters.
 */
export function resolveSeedAuthPassword(env: NodeJS.ProcessEnv = process.env): string | null {
  const b64 = env.AUTH_PASS_B64
  if (b64 && b64.trim().length > 0) {
    const normalized = b64.trim()
    const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
    if (!base64Pattern.test(normalized)) {
      logger.warn('AUTH_PASS_B64 is not valid base64; falling back to AUTH_PASS')
      return env.AUTH_PASS || null
    }

    try {
      const decoded = Buffer.from(normalized, 'base64').toString('utf8')
      const canonical = Buffer.from(decoded, 'utf8').toString('base64')
      if (canonical !== normalized) {
        logger.warn('AUTH_PASS_B64 failed base64 verification; falling back to AUTH_PASS')
        return env.AUTH_PASS || null
      }
      if (decoded.length > 0) return decoded
      logger.warn('AUTH_PASS_B64 is set but decoded to an empty value; falling back to AUTH_PASS')
    } catch {
      logger.warn('AUTH_PASS_B64 is not valid base64; falling back to AUTH_PASS')
    }
  }

  return env.AUTH_PASS || null
}

/**
 * Seeds the first admin user from environment variables if the users table is empty.
 * Skipped during `next build` — env vars are not reliably present at build time.
 */
export function seedAdminUserFromEnv(dbConn: Database.Database): void {
  // Skip seeding during `next build` — env vars may not be available yet
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const count = (dbConn.prepare('SELECT COUNT(*) as count FROM users').get() as CountRow).count
  if (count > 0) return

  const username = process.env.AUTH_USER || 'admin'
  const password = resolveSeedAuthPassword()

  if (!password) {
    // No AUTH_PASS set — admin will be created via /setup web wizard instead
    logger.info(
      'AUTH_PASS is not set — admin account will be created via /setup. ' +
      'Set AUTH_PASS or AUTH_PASS_B64 to seed an admin from env (useful for CI/automation).'
    )
    return
  }

  if (INSECURE_PASSWORDS.has(password)) {
    logger.warn(
      `AUTH_PASS matches a known insecure default ("${password}"). ` +
      'Please set a strong, unique password in your .env file. ' +
      'Skipping admin user seeding until credentials are changed.'
    )
    return
  }

  const displayName = username.charAt(0).toUpperCase() + username.slice(1)

  dbConn.prepare(`
    INSERT OR IGNORE INTO users (username, display_name, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(username, displayName, hashPassword(password), 'admin')

  logger.info(`Seeded admin user: ${username}`)
}

