import { z } from 'zod'
import { pricedFlyJob } from './fly-pricing'

export const flySubmissionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(12000),
  repository: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/),
  base_sha: z.string().regex(/^[a-f0-9]{40}$/).transform(value => value.toLowerCase()),
  runtime: z.enum(['command', 'claude', 'codex']).default('command'),
  setup: z.enum(['none', 'npm-ci', 'pnpm-ci', 'npm-ci-playwright', 'pnpm-ci-playwright']).default('none'),
  checks: z.array(z.enum(['smoke', 'test', 'lint', 'typecheck', 'build', 'test:e2e'])).min(1).max(6).default(['smoke']),
  timeout_seconds: z.number().int().min(60).max(1800).default(900),
  estimated_minutes: z.number().min(1).max(30).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  session_id: z.string().max(200).optional(),
  swarm_id: z.string().max(200).optional(),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional(),
}).strict().refine(value => !/\u0000|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|token|password)\s*[:=]\s*\S{12,}/i.test(`${value.title}\n${value.description}`), { message: 'Payload contains prohibited credential-like content or a null character' })

export type FlySubmission = z.infer<typeof flySubmissionSchema>

export function flyNumber(key: string, fallback = 0): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function flyReadiness(input?: FlySubmission): string[] {
  const issues: string[] = []
  if (process.env.MC_FLY_ENABLED !== 'true') issues.push('Fly offload is disabled')
  if (!process.env.FLY_API_TOKEN) issues.push('Fly app credential is missing')
  if (!process.env.MC_FLY_WORKER_APP) issues.push('Dedicated worker app is missing')
  if (process.env.MC_FLY_POLL_PROTOCOL !== '1') issues.push('Polled worker image has not been commissioned')
  for (const key of ['MC_FLY_PER_JOB_BUDGET_USD', 'MC_FLY_DAILY_BUDGET_USD', 'MC_FLY_MONTHLY_BUDGET_USD']) {
    if (!flyNumber(key)) issues.push(`${key} must be configured`)
  }
  if (!process.env.MC_FLY_ALLOWED_REPOS) issues.push('Repository allowlist is empty')
  if (input && !(process.env.MC_FLY_ALLOWED_REPOS || '').split(',').map(s => s.trim()).includes(input.repository)) {
    issues.push('Repository is not approved for Fly')
  }
  if (input && input.runtime !== 'command') {
    // Provider inference spend has no hard reservation implementation yet.
    // Keep subscription reasoning in the client; this is an explicit limit.
    issues.push('Remote LLM runtimes are not commissioned; use command checks with the local subscription coordinator')
  }
  if (input) issues.push(...pricedFlyJob(input).issues)
  else {
    // Readiness means at least the default command-smoke path is configured.
    issues.push(...pricedFlyJob({ setup: 'none', checks: ['smoke'], timeout_seconds: 60 }).issues)
  }
  return issues
}
