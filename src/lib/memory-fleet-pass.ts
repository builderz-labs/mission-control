import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fleetMemoryRoots } from '@/lib/memory-roots'
import { collectFleetWikiStems } from '@/lib/memory-stems'
import { consolidatePass, gapDetectPass, type GapReport } from '@/lib/memory-utils'

export async function gapDetectFleet(): Promise<GapReport> {
  const extraStems = collectFleetWikiStems()
  const reports: GapReport[] = []
  for (const root of fleetMemoryRoots()) {
    const folders = root.prefixes.length ? root.prefixes : ['']
    for (const folder of folders) {
      const fullPath = folder ? join(root.root, folder) : root.root
      if (!existsSync(fullPath)) continue
      reports.push(await gapDetectPass(fullPath, { extraStems }))
    }
  }
  const gaps = reports.flatMap((report) => report.gaps).sort((a, b) => b.severity - a.severity)
  return {
    action: 'gap-detect',
    filesProcessed: reports.reduce((sum, report) => sum + report.filesProcessed, 0),
    gaps: gaps.slice(0, 50),
    summary: {
      brokenLinks: gaps.filter((gap) => gap.type === 'broken-link').length,
      orphans: gaps.filter((gap) => gap.type === 'orphan').length,
      stale: gaps.filter((gap) => gap.type === 'stale').length,
      knowledgeGaps: gaps.filter((gap) => gap.type === 'knowledge-gap').length,
    },
  }
}

export async function consolidateFleet() {
  const extraStems = collectFleetWikiStems()
  const items = []
  for (const root of fleetMemoryRoots()) {
    const folders = root.prefixes.length ? root.prefixes : ['']
    for (const folder of folders) {
      const fullPath = folder ? join(root.root, folder) : root.root
      if (!existsSync(fullPath)) continue
      const result = await consolidatePass(fullPath)
      items.push(...(result.items || []))
    }
  }
  return {
    action: 'consolidate',
    filesProcessed: items.length,
    items: items.slice(0, 50),
    extraStems,
  }
}
