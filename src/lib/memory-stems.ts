import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fleetMemoryRoots } from '@/lib/memory-roots'
import { fileStem } from '@/lib/memory-file-class'

const HUB_STEMS = [
  'unified-brain-graph',
  'dev-fleet',
  'agents-index',
  'skills-index',
  'sessions-index',
  'session-index-claude',
  'session-index-codex',
  'session-index-grok',
  'session-index-kimi',
  'mcp-index',
  'fleet-index',
  'BRAIN',
]

export function collectCatalogStems(vaultRoot: string): string[] {
  const catalog = join(vaultRoot, 'Wiki', 'catalog.jsonl')
  if (!existsSync(catalog)) return []
  const stems: string[] = []
  for (const line of readFileSync(catalog, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as { path?: string }
      if (row.path) stems.push(fileStem(row.path))
    } catch {
      // skip malformed catalog lines
    }
  }
  return stems
}

export function collectFleetWikiStems(): string[] {
  const stems = new Set<string>(HUB_STEMS)
  for (const root of fleetMemoryRoots()) {
    if (root.id === 'omnia-vault') {
      for (const stem of collectCatalogStems(root.root)) stems.add(stem)
    }
  }
  return [...stems]
}
