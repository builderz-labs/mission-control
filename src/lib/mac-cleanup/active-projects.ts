import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { capture } from './exec'
import {
  alwaysProtectedRoots,
  devProjectRoot,
  extractDevPathsFromCommand,
  parseLeaseProjectRoots,
  parseLsofCwds,
  uniqueRoots,
} from './protect'

function leaseRoots(home: string): string[] {
  const dir = join(home, '.local/state/ai-agent-leases')
  try {
    const files = readdirSync(dir).filter((name) => name.endsWith('.lease'))
    const roots: string[] = []
    for (const file of files.slice(0, 200)) {
      const raw = readFileSync(join(dir, file), 'utf8')
      roots.push(...parseLeaseProjectRoots(raw))
    }
    return roots
  } catch {
    return []
  }
}

export async function collectProtectedRoots(home = homedir()): Promise<string[]> {
  const lsof = await capture('lsof', ['-a', '-d', 'cwd', '-Fn'])
  const cwds = parseLsofCwds(lsof)
  const ps = await capture('ps', ['axo', 'command='])
  const fromCommands: string[] = []
  for (const line of ps.split('\n')) {
    fromCommands.push(...extractDevPathsFromCommand(line, home))
  }

  const fromCwds = cwds
    .map((cwd) => devProjectRoot(cwd, home))
    .filter((root): root is string => Boolean(root))
  const fromCmd = fromCommands
    .map((path) => devProjectRoot(path, home))
    .filter((root): root is string => Boolean(root))

  const roots = uniqueRoots([
    ...alwaysProtectedRoots(home),
    ...leaseRoots(home),
    ...fromCwds,
    ...fromCmd,
  ], home)

  if (!lsof.trim()) {
    return uniqueRoots([...roots, ...alwaysProtectedRoots(home)], home)
  }
  return roots
}
