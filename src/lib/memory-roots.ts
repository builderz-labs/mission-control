import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveSafeMemoryPath } from '@/lib/memory-path'

export interface MemoryRoot {
  id: string
  label: string
  root: string
  prefixes: string[]
}

export function fleetMemoryRoots(home = homedir()): MemoryRoot[] {
  const roots: MemoryRoot[] = []
  const vault = join(home, 'Dev', 'omnia-vault')
  if (existsSync(join(vault, 'Wiki'))) {
    roots.push({
      id: 'omnia-vault',
      label: 'Omnia Vault',
      root: vault,
      prefixes: ['Wiki', '_relay', 'Schema', 'Plan', 'graphify', 'Raw/Sources', '.claude/skills', '.claude/commands'],
    })
  }
  const skills = join(home, '.agents', 'skills')
  if (existsSync(skills)) {
    roots.push({ id: 'skills', label: 'Skills', root: skills, prefixes: [] })
  }
  const openclaw = join(home, '.openclaw', 'memory')
  if (existsSync(openclaw)) {
    roots.push({ id: 'openclaw', label: 'OpenClaw', root: openclaw, prefixes: [] })
  }
  return roots
}

export function locateMemoryPath(
  relativePath: string,
  roots = fleetMemoryRoots(),
): { root: MemoryRoot; rest: string } | null {
  const canonical = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!canonical) return null
  const slash = canonical.indexOf('/')
  const head = slash === -1 ? canonical : canonical.slice(0, slash)
  const rest = slash === -1 ? '' : canonical.slice(slash + 1)
  const root = roots.find((item) => item.id === head)
  if (!root) return null
  if (root.prefixes.length && rest) {
    const allowed = root.prefixes.some((prefix) => rest === prefix || rest.startsWith(`${prefix}/`))
    if (!allowed) return null
  }
  return { root, rest }
}

export function isSharedMemoryWritePath(relativePath: string): boolean {
  const located = locateMemoryPath(relativePath)
  return located?.root.id === 'openclaw'
}

export async function resolveSharedMemoryTarget(relativePath: string) {
  const located = locateMemoryPath(relativePath)
  if (!located) return null
  if (!located.rest) {
    return { ...located, abs: located.root.root }
  }
  const abs = await resolveSafeMemoryPath(located.root.root, located.rest)
  return { ...located, abs }
}
