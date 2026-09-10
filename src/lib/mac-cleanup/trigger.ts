import { lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { runCommand } from '@/lib/command'
import { CATALOG, catalogBinary } from './catalog'
import { decideTrigger } from './policy'
import { formatReclaimReport, runSafeReclaim } from './reclaim'
import type {
  CleanupMode,
  LiveMetrics,
  Thresholds,
  TriggerIntent,
  TriggerResult,
  TriggerableId,
} from './types'
import { DEFAULT_THRESHOLDS, TRIGGERABLE_IDS } from './types'

const AUTO_TIMEOUT_MS: Record<TriggerableId, number> = {
  'safe-reclaim': 120_000,
  'resource-guardian': 20_000,
  'storage-maintenance': 120_000,
}

export function isTriggerableId(value: string): value is TriggerableId {
  return (TRIGGERABLE_IDS as readonly string[]).includes(value)
}

export function isAllowlistedBinary(
  candidate: string,
  expected: string,
  stat: { isFile(): boolean; isSymbolicLink(): boolean; uid: number; mode: number; nlink: number },
  uid = typeof process.getuid === 'function' ? process.getuid() : -1,
): boolean {
  if (candidate !== expected) return false
  if (stat.isSymbolicLink() || !stat.isFile()) return false
  if (stat.nlink !== 1) return false
  if ((stat.mode & 0o777) !== 0o700) return false
  if (uid >= 0 && stat.uid !== uid) return false
  return true
}

export async function runMacCleanup(input: {
  id: TriggerableId
  mode: CleanupMode
  intent: TriggerIntent
  metrics: LiveMetrics
  thresholds?: Thresholds
  lastAutoAt?: number | null
  now?: number
}): Promise<TriggerResult> {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS
  const decision = decideTrigger({
    id: input.id,
    mode: input.mode,
    intent: input.intent,
    metrics: input.metrics,
    thresholds,
    lastAutoAt: input.lastAutoAt,
    now: input.now,
  })
  if (!decision.allowed) {
    return emptyResult(input.id, input.mode, decision)
  }

  if (input.id === 'safe-reclaim') {
    const report = await runSafeReclaim(input.mode)
    return {
      ok: report.ok,
      id: input.id,
      mode: input.mode,
      decision,
      stdout: formatReclaimReport(report),
      stderr: '',
      code: report.ok ? 0 : 1,
    }
  }

  const entry = CATALOG.find((item) => item.id === input.id)
  if (!entry || !entry.triggerable) {
    return emptyResult(input.id, input.mode, {
      allowed: false,
      code: 'unknown_job',
      reason: 'Automation is not triggerable.',
    })
  }

  const binary = catalogBinary(entry, homedir())
  try {
    const stat = lstatSync(binary)
    if (!isAllowlistedBinary(binary, binary, stat)) {
      return emptyResult(input.id, input.mode, {
        allowed: false,
        code: 'unsafe_binary',
        reason: 'Binary failed owner/mode/symlink checks.',
      })
    }
  } catch {
    return emptyResult(input.id, input.mode, {
      allowed: false,
      code: 'missing_binary',
      reason: 'Allowlisted binary is not installed.',
    })
  }

  const timeoutMs = input.mode === 'auto' ? AUTO_TIMEOUT_MS[input.id] : 20_000
  try {
    const result = await runCommand(binary, [`--${input.mode}`], { timeoutMs })
    return {
      ok: result.code === 0,
      id: input.id,
      mode: input.mode,
      decision,
      stdout: result.stdout.slice(0, 4000),
      stderr: result.stderr.slice(0, 2000),
      code: result.code,
    }
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string; code?: number | null }
    return {
      ok: false,
      id: input.id,
      mode: input.mode,
      decision,
      stdout: String(err.stdout ?? '').slice(0, 4000),
      stderr: String(err.stderr ?? err.message ?? 'Command failed').slice(0, 2000),
      code: typeof err.code === 'number' ? err.code : null,
    }
  }
}

function emptyResult(
  id: TriggerableId,
  mode: CleanupMode,
  decision: TriggerResult['decision'],
): TriggerResult {
  return { ok: false, id, mode, decision, stdout: '', stderr: '', code: null }
}
