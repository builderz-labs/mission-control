import { spawnSync } from 'node:child_process'

export function gitSnapshot(cwd: string): string {
  if (!cwd) return ''
  try {
    const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 3000 })
    if (branch.status !== 0) return ''
    const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 3000 })
    const lines = String(status.stdout || '').split('\n').filter(Boolean).slice(0, 20)
    return [`branch: ${String(branch.stdout || '').trim()}`, ...lines].join('\n')
  } catch {
    return ''
  }
}
