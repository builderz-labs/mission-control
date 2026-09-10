import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { collectProtectedRoots } from './active-projects'
import { capture } from './exec'
import { reclaimIdleCpu } from './reclaim-cpu'
import { isSafeDeleteTarget } from './protect'
import { reclaimTargets, toolIsActive, type ReclaimAction, type ReclaimTarget } from './reclaim-targets'

export type { ReclaimAction }

export interface ReclaimReport {
  ok: boolean
  mode: 'audit' | 'dry-run' | 'auto'
  protected: string[]
  actions: ReclaimAction[]
}

function uid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : -1
}

function snapshotProcesses(): Promise<string> {
  return capture('ps', ['axo', 'command='], 5000)
}

function safeRm(target: string, prefix: string, protectedRoots: string[]): boolean {
  try {
    const stat = lstatSync(target)
    if (!isSafeDeleteTarget(target, prefix, protectedRoots, uid(), stat)) return false
    rmSync(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

function reclaimDir(target: ReclaimTarget, protectedRoots: string[], processes: string, mutate: boolean): ReclaimAction {
  if (toolIsActive(target.idle, processes)) {
    return { id: target.id, path: target.path, status: 'deferred', reason: `${target.idle} is active` }
  }
  try {
    const stat = lstatSync(target.path)
    if (!isSafeDeleteTarget(target.path, target.path, protectedRoots, uid(), stat)) {
      return { id: target.id, path: target.path, status: 'protected', reason: 'Path is in an active project or failed safety checks' }
    }
  } catch {
    return { id: target.id, path: target.path, status: 'missing', reason: 'Path is absent' }
  }
  if (!mutate) {
    return { id: target.id, path: target.path, status: 'skipped', reason: 'Would clear this cache' }
  }
  const cleared = safeRm(target.path, target.path, protectedRoots)
  return {
    id: target.id,
    path: target.path,
    status: cleared ? 'cleaned' : 'protected',
    reason: cleared ? 'Cleared regenerable cache' : 'Blocked by safety checks',
  }
}

function reclaimIdleChildren(target: ReclaimTarget, protectedRoots: string[], mutate: boolean): ReclaimAction[] {
  const actions: ReclaimAction[] = []
  let names: string[] = []
  try {
    names = readdirSync(target.path)
  } catch {
    return [{ id: target.id, path: target.path, status: 'missing', reason: 'Idle tree is absent' }]
  }
  for (const name of names) {
    const project = join(target.path, name)
    for (const child of target.childNames ?? []) {
      const path = join(project, child)
      try {
        lstatSync(path)
      } catch {
        continue
      }
      if (!isSafeDeleteTarget(path, target.path, protectedRoots, uid(), lstatSync(path))) {
        actions.push({ id: `${target.id}:${name}:${child}`, path, status: 'protected', reason: 'Active or unsafe path' })
        continue
      }
      if (!mutate) {
        actions.push({ id: `${target.id}:${name}:${child}`, path, status: 'skipped', reason: 'Would clear idle cache' })
        continue
      }
      const cleared = safeRm(path, target.path, protectedRoots)
      actions.push({
        id: `${target.id}:${name}:${child}`,
        path,
        status: cleared ? 'cleaned' : 'protected',
        reason: cleared ? 'Cleared idle project cache' : 'Blocked by safety checks',
      })
    }
  }
  return actions
}

export async function runSafeReclaim(mode: 'audit' | 'dry-run' | 'auto', home = homedir()): Promise<ReclaimReport> {
  const mutate = mode === 'auto'
  const [protectedRoots, processes] = await Promise.all([
    collectProtectedRoots(home),
    snapshotProcesses(),
  ])
  const actions: ReclaimAction[] = []
  for (const target of reclaimTargets(home)) {
    if (target.kind === 'idle-children') {
      actions.push(...reclaimIdleChildren(target, protectedRoots, mutate))
    } else {
      actions.push(reclaimDir(target, protectedRoots, processes, mutate))
    }
  }
  actions.push(...await reclaimIdleCpu(protectedRoots, mutate, home))
  return { ok: true, mode, protected: protectedRoots, actions }
}

export function formatReclaimReport(report: ReclaimReport): string {
  const cleaned = report.actions.filter((action) => action.status === 'cleaned').length
  const deferred = report.actions.filter((action) => action.status === 'deferred').length
  const protectedCount = report.protected.length
  return JSON.stringify({
    mode: report.mode,
    cleaned,
    deferred,
    protectedProjects: protectedCount,
    actions: report.actions.slice(0, 40),
  })
}
