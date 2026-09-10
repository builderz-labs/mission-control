import { homedir } from 'node:os'
import { allSeedProjects, type FleetProjectSpec } from '@/lib/fleet-projects'

const PATH_ALIASES: Array<{ prefix: string; name: string }> = [
  { prefix: '~/actz-may', name: 'actz-may' },
  { prefix: '~/Faithful_Heart_&_Healing_Oasis', name: 'faithful-heart-healing-oasis' },
  { prefix: '~/Faithful_Heart', name: 'faithful-heart-healing-oasis' },
]

function tildePath(raw: string): string {
  const home = homedir()
  const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === home) return '~'
  if (normalized.startsWith(`${home}/`)) return `~${normalized.slice(home.length)}`
  return normalized
}

function specByName(name: string): FleetProjectSpec | null {
  return allSeedProjects().find((spec) => spec.name === name || spec.slug === name) || null
}

export function matchFleetProject(cwd: string | null | undefined): FleetProjectSpec | null {
  if (!cwd) return null
  const path = tildePath(cwd)
  let best: FleetProjectSpec | null = null
  for (const spec of allSeedProjects()) {
    if (path === spec.path || path.startsWith(`${spec.path}/`)) {
      if (!best || spec.path.length > best.path.length) best = spec
    }
  }
  if (best) return best
  for (const alias of PATH_ALIASES) {
    if (path === alias.prefix || path.startsWith(`${alias.prefix}/`)) {
      return specByName(alias.name)
    }
  }
  const parts = path.split('/').filter(Boolean)
  for (const spec of allSeedProjects()) {
    if (parts.includes(spec.name) || parts.includes(spec.slug)) return spec
  }
  return null
}

export function fleetProjectSlug(cwd: string | null | undefined): string | null {
  return matchFleetProject(cwd)?.slug ?? null
}
