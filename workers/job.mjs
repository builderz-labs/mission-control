export const CHECKS = new Set(['smoke', 'test', 'lint', 'typecheck', 'build', 'test:e2e'])
const SETUPS = new Set(['none', 'npm-ci', 'pnpm-ci', 'npm-ci-playwright', 'pnpm-ci-playwright'])
const RUNTIMES = new Set(['command'])

function text(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`Invalid job ${field}`)
  }
  return value.trim()
}

export function validateJob(value, now = Math.floor(Date.now() / 1000)) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid job document')
  const id = text(value.id, 'id', 96)
  const title = text(value.title, 'title', 240)
  const description = text(value.description, 'description', 12_000)
  const repository = text(value.repository, 'repository', 500)
  const base_sha = text(value.base_sha, 'base_sha', 40).toLowerCase()
  const branch_name = text(value.branch_name, 'branch_name', 120)
  let url
  try { url = new URL(repository) } catch { throw new Error('Invalid job repository') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.git')) {
    throw new Error('Job repository must be credential-free HTTPS Git')
  }
  if (!/^[a-zA-Z0-9_-]{12,96}$/.test(id) || !/^[a-f0-9]{40}$/.test(base_sha)) throw new Error('Invalid job identity or revision')
  if (!/^mc\/fly-task-\d+-[a-z0-9]{8}$/.test(branch_name)) throw new Error('Invalid isolated branch')
  if (!RUNTIMES.has(value.runtime) || !SETUPS.has(value.setup)) throw new Error('Unsupported job runtime or setup')
  if (!Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 6 || value.checks.some(check => !CHECKS.has(check))) {
    throw new Error('Job requires supported verification checks')
  }
  if (!Number.isInteger(value.timeout_seconds) || value.timeout_seconds < 1 || value.timeout_seconds > 1800) throw new Error('Invalid job timeout')
  if (!Number.isInteger(value.expires_at) || value.expires_at <= now) throw new Error('Job has expired')
  return { id, title, description, repository, base_sha, branch_name, runtime: value.runtime, setup: value.setup,
    checks: [...new Set(value.checks)], timeout_seconds: value.timeout_seconds, expires_at: value.expires_at }
}

export async function loadJob(file = '/etc/mc-job.json') {
  if ((await stat(file)).size > 65_536) throw new Error('Job document exceeds the size limit')
  const raw = await readFile(file, 'utf8')
  if (Buffer.byteLength(raw) > 65_536) throw new Error('Job document exceeds the size limit')
  let value
  try { value = JSON.parse(raw) } catch { throw new Error('Job document is not valid JSON') }
  return validateJob(value)
}
import { readFile, stat } from 'node:fs/promises'


