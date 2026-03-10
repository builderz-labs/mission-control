import { existsSync, readdirSync, statSync } from 'fs'
import { basename, dirname, extname, join, relative } from 'path'

export type WorkspaceSnapshot = Record<string, string>

export type TaskExecutionVerification = {
  passed: boolean
  requiresChanges: boolean
  reason: string
  changedFiles: string[]
}

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.wrangler',
  '.data',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'output',
  'tmp',
  'temp',
  'logs',
])

const TRACKED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.css',
  '.scss',
  '.html',
  '.sql',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
])

function shouldIgnoreDir(name: string) {
  return IGNORED_DIRS.has(name.toLowerCase())
}

function shouldTrackFile(filePath: string) {
  const name = basename(filePath).toLowerCase()
  if (
    name === '.ds_store'
    || name.endsWith('.log')
    || name.endsWith('.tmp')
    || name.endsWith('.lock')
  ) {
    return false
  }

  const ext = extname(name).toLowerCase()
  return TRACKED_EXTENSIONS.has(ext) || !ext
}

export function findWorkspaceRootFromPath(filePath: string): string {
  let current = existsSync(filePath) ? (statSync(filePath).isDirectory() ? filePath : dirname(filePath)) : dirname(filePath)
  let best = current

  while (true) {
    const markers = [
      join(current, 'package.json'),
      join(current, 'pnpm-workspace.yaml'),
      join(current, 'vite.config.ts'),
      join(current, 'next.config.js'),
      join(current, '.git'),
    ]

    if (markers.some((marker) => existsSync(marker))) {
      return current
    }

    best = current
    const parent = dirname(current)
    if (parent === current) {
      return best
    }
    current = parent
  }
}

export function captureWorkspaceSnapshot(root: string, maxDepth = 6): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = {}
  if (!root || !existsSync(root)) return snapshot

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return

    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && shouldIgnoreDir(entry.name)) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (shouldIgnoreDir(entry.name)) continue
        walk(fullPath, depth + 1)
        continue
      }

      if (!entry.isFile() || !shouldTrackFile(fullPath)) continue

      try {
        const stat = statSync(fullPath)
        const relPath = relative(root, fullPath).replace(/\\/g, '/')
        snapshot[relPath] = `${stat.size}:${Math.floor(stat.mtimeMs)}`
      } catch {
        // Best-effort snapshot only.
      }
    }
  }

  walk(root, 0)
  return snapshot
}

export function diffWorkspaceSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  const changed = new Set<string>()
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (before[key] !== after[key]) changed.add(key)
  }
  return Array.from(changed).sort()
}

export function taskRequiresWorkspaceChanges(taskStatus: string) {
  return taskStatus !== 'review' && taskStatus !== 'quality_review'
}

export function verifyTaskExecution(args: {
  taskStatus: string
  output: string
  beforeSnapshot: WorkspaceSnapshot
  afterSnapshot: WorkspaceSnapshot
  generatedFiles?: string[]
  priorVerifiedChangedFiles?: string[]
}) : TaskExecutionVerification {
  const changedFiles = diffWorkspaceSnapshots(args.beforeSnapshot, args.afterSnapshot)
  const requiresChanges = taskRequiresWorkspaceChanges(args.taskStatus)
  const output = args.output || ''
  const generatedFiles = args.generatedFiles ?? []
  const priorVerifiedChangedFiles = args.priorVerifiedChangedFiles ?? []

  if (requiresChanges && changedFiles.length === 0) {
    return {
      passed: false,
      requiresChanges,
      reason: 'Process exited without any verified workspace changes. Task was re-queued instead of being marked complete.',
      changedFiles,
    }
  }

  if (!requiresChanges && changedFiles.length === 0 && generatedFiles.length === 0) {
    if (priorVerifiedChangedFiles.length === 0) {
      return {
        passed: false,
        requiresChanges,
        reason: 'Review stage has no verified implementation diff from a previous pass, so the task was re-queued.',
        changedFiles,
      }
    }
    const looksIncomplete = /\b(no\s+changes?|nothing\s+(?:changed|done)|unable\s+to|could\s+not|not\s+implemented|failed|error)\b/i.test(output)
    if (looksIncomplete) {
      return {
        passed: false,
        requiresChanges,
        reason: 'Review run exited without evidence of a completed review step.',
        changedFiles,
      }
    }
  }

  return {
    passed: true,
    requiresChanges,
    reason: changedFiles.length > 0
      ? `Verified ${changedFiles.length} workspace change(s).`
      : generatedFiles.length > 0
        ? `Verified ${generatedFiles.length} generated artifact(s).`
        : 'No file changes required for this workflow stage.',
    changedFiles,
  }
}
