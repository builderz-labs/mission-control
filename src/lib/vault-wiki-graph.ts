import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface GraphFileInfo {
  path: string
  chunks: number
  textSize: number
}

export interface GraphAgentData {
  name: string
  dbSize: number
  totalChunks: number
  totalFiles: number
  files: GraphFileInfo[]
}

interface CatalogRow {
  path?: string
  title?: string
  topics?: string[]
  sources?: string[]
}

function readCatalog(vaultRoot: string): CatalogRow[] {
  const catalogPath = join(vaultRoot, 'Wiki', 'catalog.jsonl')
  if (!existsSync(catalogPath)) return []
  return readFileSync(catalogPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CatalogRow]
      } catch {
        return []
      }
    })
}

export function loadVaultWikiGraph(vaultRoot: string): GraphAgentData | null {
  const rows = readCatalog(vaultRoot)
  if (!rows.length) return null
  const files = rows
    .filter((row) => typeof row.path === 'string' && row.path)
    .map((row) => ({
      path: row.path as string,
      chunks: 1 + (row.topics?.length || 0) + (row.sources?.length || 0),
      textSize: 0,
    }))
  return {
    name: 'omnia-vault',
    dbSize: files.length,
    totalChunks: files.reduce((sum, file) => sum + file.chunks, 0),
    totalFiles: files.length,
    files,
  }
}

type HistoryRow = { path?: string; sessions?: number; count?: number }

function historyFiles(payload: { projects?: HistoryRow[]; stores?: HistoryRow[] }): GraphFileInfo[] {
  return [...(payload.projects || []), ...(payload.stores || [])]
    .filter((row) => typeof row.path === 'string' && row.path)
    .map((row) => ({
      path: row.path as string,
      chunks: Math.max(1, Number(row.sessions) || Number(row.count) || 1),
      textSize: 0,
    }))
}

export function loadHistoryGraph(historyPath: string, fallbackName: string): GraphAgentData | null {
  if (!existsSync(historyPath)) return null
  try {
    const payload = JSON.parse(readFileSync(historyPath, 'utf8')) as {
      name?: string
      projects?: HistoryRow[]
      stores?: HistoryRow[]
    }
    const files = historyFiles(payload)
    if (!files.length) return null
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : fallbackName
    return {
      name,
      dbSize: files.length,
      totalChunks: files.reduce((sum, file) => sum + file.chunks, 0),
      totalFiles: files.length,
      files,
    }
  } catch {
    return null
  }
}

export function loadClaudeHistoryGraph(historyPath: string): GraphAgentData | null {
  return loadHistoryGraph(historyPath, 'claude-history')
}

export function loadBrainGraph(graphPath: string): GraphAgentData | null {
  if (!existsSync(graphPath)) return null
  try {
    const payload = JSON.parse(readFileSync(graphPath, 'utf8')) as {
      name?: string
      nodes?: Array<{ id?: string }>
      edges?: Array<unknown>
    }
    const files = (payload.nodes || [])
      .filter((row) => typeof row.id === 'string' && row.id)
      .map((row) => ({ path: row.id as string, chunks: 1, textSize: 0 }))
    if (!files.length) return loadHistoryGraph(graphPath, 'brain-graph')
    const extra = Array.isArray(payload.edges) ? payload.edges.length : 0
    return {
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'brain-graph',
      dbSize: files.length,
      totalChunks: files.length + extra,
      totalFiles: files.length,
      files,
    }
  } catch {
    return null
  }
}

export function loadSkillsGraph(skillsRoot: string): GraphAgentData | null {
  if (!existsSync(skillsRoot)) return null
  const files: GraphFileInfo[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(skillsRoot)
  } catch {
    return null
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const nested = join(skillsRoot, name)
    const skillMd = join(nested, 'SKILL.md')
    if (existsSync(skillMd)) {
      try {
        files.push({ path: `skills/${name}/SKILL.md`, chunks: 1, textSize: statSync(skillMd).size })
      } catch {
        continue
      }
    }
    let children: string[] = []
    try {
      children = readdirSync(nested)
    } catch {
      continue
    }
    for (const child of children) {
      if (child.startsWith('.')) continue
      const nestedMd = join(nested, child, 'SKILL.md')
      if (!existsSync(nestedMd)) continue
      try {
        files.push({ path: `skills/${name}/${child}/SKILL.md`, chunks: 1, textSize: statSync(nestedMd).size })
      } catch {
        continue
      }
    }
  }
  files.sort((left, right) => left.path.split('/').length - right.path.split('/').length || left.path.localeCompare(right.path))
  if (!files.length) return null
  return {
    name: 'skills',
    dbSize: files.reduce((sum, file) => sum + file.textSize, 0),
    totalChunks: files.length,
    totalFiles: files.length,
    files,
  }
}
