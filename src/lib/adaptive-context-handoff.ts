import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCommand } from '@/lib/command'
import { redactSecrets } from '@/lib/handoff-redact'
import type { FleetAgentName } from '@/lib/fleet-agents'

const TIMEOUT_MS = 20_000

export interface AdaptiveHandoffPin {
  from: FleetAgentName
  to: FleetAgentName
  window: number
  compactRequired: boolean
  env: Record<string, string>
  argv: string[]
  policyPath: string
}

export function adaptiveContextCli(home = os.homedir()): string {
  return process.env.ADAPTIVE_CONTEXT_CLI || path.join(home, '.agents/scripts/adaptive-context.mjs')
}

export async function resolveWorkspacePolicyPath(cwd: string, home = os.homedir()): Promise<string> {
  const workspace = path.join(cwd, '.adaptive-context', 'policy.json')
  try {
    await fs.access(workspace)
    return workspace
  } catch {
    return path.join(home, '.adaptive-context', 'policy.json')
  }
}

export function ledgerFromSession(input: { title: string; excerpt: string }): Record<string, string> {
  return {
    objective: redactSecrets(`Continue ${input.title}`.slice(0, 400)),
    constraints: '',
    decisions: '',
    files: '',
    verification: '',
    next: redactSecrets(input.excerpt).slice(0, 2000),
    risks: '',
  }
}

async function writeLedger(policyPath: string, ledger: Record<string, string>): Promise<string> {
  const dir = path.dirname(policyPath)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, 'ledger.json')
  await fs.writeFile(target, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 })
  return target
}

export function parseAdaptiveHandoff(stdout: string): Pick<AdaptiveHandoffPin, 'window' | 'env' | 'argv' | 'compactRequired'> {
  let parsed: {
    ok?: boolean
    handoff?: { window?: number; compactRequired?: boolean }
    launch?: { to?: { env?: Record<string, string>; argv?: unknown } }
  }
  try { parsed = JSON.parse(stdout) as typeof parsed }
  catch { throw new Error('adaptive_context_failed: handoff output was not JSON') }
  const window = parsed.handoff?.window
  const env = parsed.launch?.to?.env
  const argv = parsed.launch?.to?.argv
  if (
    !parsed.ok
    || typeof window !== 'number'
    || !Number.isInteger(window)
    || !env
    || !Array.isArray(argv)
    || argv.some((item) => typeof item !== 'string')
  ) {
    throw new Error('adaptive_context_failed: handoff output was incomplete')
  }
  return { window, env, argv: argv as string[], compactRequired: parsed.handoff?.compactRequired === true }
}

export async function pinAdaptiveContext(input: {
  from: FleetAgentName
  to: FleetAgentName
  cwd: string
  title: string
  excerpt: string
}): Promise<AdaptiveHandoffPin> {
  const home = process.env.ADAPTIVE_CONTEXT_CONFIG_HOME || os.homedir()
  const policyPath = await resolveWorkspacePolicyPath(input.cwd, home)
  const ledgerFile = await writeLedger(policyPath, ledgerFromSession(input))
  const args = [
    'handoff', '--from', input.from, '--to', input.to,
    '--policy-path', policyPath, '--config-home', home,
    '--ledger-file', ledgerFile, '--no-project-config',
  ]
  const run = () => runCommand(adaptiveContextCli(home), args, { timeoutMs: TIMEOUT_MS, cwd: input.cwd })
  let result: { stdout: string }
  try { result = await run() }
  catch { result = await run() }
  return { from: input.from, to: input.to, policyPath, ...parseAdaptiveHandoff(result.stdout) }
}
