/**
 * MOC (Map of Content) generation, context payload construction,
 * and the reflect / reweave processing pipeline passes.
 */

import { readFile } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { buildLinkGraph, scanMemoryFiles } from './health-diagnostics'

// ─── MOC generation ──────────────────────────────────────────────

export interface MOCEntry {
  title: string
  path: string
  linkCount: number   // total in + out links
}

export interface MOCGroup {
  directory: string
  entries: MOCEntry[]
}

/**
 * Auto-generate Maps of Content by grouping files by directory
 * and sorting by connectivity.
 */
export async function generateMOCs(baseDir: string): Promise<MOCGroup[]> {
  const graph = await buildLinkGraph(baseDir)
  const dirMap = new Map<string, MOCEntry[]>()

  for (const node of Object.values(graph.nodes)) {
    const dir = dirname(node.path)
    const dirKey = dir === '.' ? '(root)' : dir
    if (!dirMap.has(dirKey)) dirMap.set(dirKey, [])

    // Extract title from first H1 or fall back to filename
    let title = basename(node.path, extname(node.path))
    try {
      const content = await readFile(join(baseDir, node.path), 'utf-8')
      const h1Match = content.match(/^#\s+(.+)/m)
      if (h1Match) title = h1Match[1].trim()
    } catch { /* use filename */ }

    dirMap.get(dirKey)!.push({
      title,
      path: node.path,
      linkCount: node.incoming.length + node.outgoing.length,
    })
  }

  // Sort entries within each group by connectivity (most linked first)
  const groups: MOCGroup[] = []
  for (const [directory, entries] of dirMap.entries()) {
    entries.sort((a, b) => b.linkCount - a.linkCount)
    groups.push({ directory, entries })
  }

  // Sort groups by total connectivity
  groups.sort((a, b) => {
    const aTotal = a.entries.reduce((s, e) => s + e.linkCount, 0)
    const bTotal = b.entries.reduce((s, e) => s + e.linkCount, 0)
    return bTotal - aTotal
  })

  return groups
}

// ─── Context injection ───────────────────────────────────────────

export interface ContextPayload {
  fileTree: string[]
  recentFiles: { path: string; modified: number }[]
  healthSummary: { overall: string; score: number }
  maintenanceSignals: string[]
}

/**
 * Generate a context injection payload for agent session start.
 * Provides workspace overview, recent files, and maintenance alerts.
 */
export async function generateContextPayload(baseDir: string): Promise<ContextPayload> {
  const files = await scanMemoryFiles(baseDir)

  const fileTree = files.map((f) => f.path).sort()

  const recentFiles = [...files]
    .sort((a, b) => b.modified - a.modified)
    .slice(0, 10)
    .map((f) => ({ path: f.path, modified: f.modified }))

  // Lightweight health check — avoid the full 8-category scan on every request
  const graph = await buildLinkGraph(baseDir)
  const now = Date.now()
  const staleThreshold = 30 * 24 * 60 * 60 * 1000
  const staleCount = files.filter((f) => now - f.modified > staleThreshold).length
  const orphanCount = graph.orphans.length

  const totalFiles = files.length
  const connectedRatio = totalFiles > 0 ? (totalFiles - orphanCount) / totalFiles : 1
  const staleRatio = totalFiles > 0 ? staleCount / totalFiles : 0
  const quickScore = Math.round(((connectedRatio + (1 - staleRatio)) / 2) * 100)
  const overall = quickScore >= 70 ? 'healthy' : quickScore >= 40 ? 'warning' : 'critical'

  const signals: string[] = []
  if (orphanCount > 5) signals.push(`${orphanCount} orphan files need wiki-links`)
  if (staleRatio > 0.3) signals.push(`${staleCount} files stale (30+ days)`)
  if (graph.totalLinks === 0 && totalFiles > 3) {
    signals.push('No wiki-links found — consider adding [[connections]]')
  }

  return {
    fileTree,
    recentFiles,
    healthSummary: { overall, score: quickScore },
    maintenanceSignals: signals,
  }
}

// ─── Processing pipeline ─────────────────────────────────────────

export interface ProcessingResult {
  action: string
  filesProcessed: number
  changes: string[]
  suggestions: string[]
}

/**
 * Generate a "reflect" report — identify connection opportunities between files
 * that share a directory but have no wiki-links to each other.
 */
export async function reflectPass(baseDir: string): Promise<ProcessingResult> {
  const graph = await buildLinkGraph(baseDir)
  const suggestions: string[] = []

  const dirGroups = new Map<string, string[]>()
  for (const node of Object.values(graph.nodes)) {
    const dir = dirname(node.path)
    if (!dirGroups.has(dir)) dirGroups.set(dir, [])
    dirGroups.get(dir)!.push(node.path)
  }

  for (const [, paths] of dirGroups) {
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const a = graph.nodes[paths[i]]
        const b = graph.nodes[paths[j]]
        if (a && b) {
          const linked = a.outgoing.includes(b.path) || b.outgoing.includes(a.path)
          if (!linked) {
            suggestions.push(
              `Consider linking [[${basename(a.path, extname(a.path))}]] <-> [[${basename(b.path, extname(b.path))}]] (same directory: ${dirname(a.path)})`
            )
          }
        }
      }
    }
  }

  return {
    action: 'reflect',
    filesProcessed: graph.totalFiles,
    changes: [],
    suggestions: suggestions.slice(0, 20),
  }
}

/**
 * Generate a "reweave" report — find stale files that could be updated
 * with context from newer linked files.
 */
export async function reweavePass(baseDir: string): Promise<ProcessingResult> {
  const files = await scanMemoryFiles(baseDir, { extensions: ['.md'] })
  const graph = await buildLinkGraph(baseDir)
  const now = Date.now()
  const staleThreshold = 14 * 24 * 60 * 60 * 1000 // 14 days
  const suggestions: string[] = []

  for (const f of files) {
    if (now - f.modified > staleThreshold) {
      const node = graph.nodes[f.path]
      if (!node) continue

      const newerLinks = [...node.incoming, ...node.outgoing].filter((linked) => {
        const linkedFile = files.find((lf) => lf.path === linked)
        return linkedFile && linkedFile.modified > f.modified
      })

      if (newerLinks.length > 0) {
        suggestions.push(
          `${f.path} is stale but has ${newerLinks.length} newer linked file(s) — review for updates`
        )
      }
    }
  }

  return {
    action: 'reweave',
    filesProcessed: files.length,
    changes: [],
    suggestions: suggestions.slice(0, 20),
  }
}
