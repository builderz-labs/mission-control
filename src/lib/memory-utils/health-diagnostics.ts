/**
 * Memory health diagnostics — link graph construction, orphan detection,
 * and an 8-category health report for the knowledge base.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, extname, basename } from 'path'
import { extractWikiLinks } from './wiki-links'
import type { WikiLink } from './wiki-links'
import { extractSchema, validateSchema } from './schema-validation'
import type { SchemaBlock } from './schema-validation'

export type { WikiLink }

// ─── File scanning ───────────────────────────────────────────────

export interface MemoryFileInfo {
  path: string       // Relative path from memory root
  name: string       // Basename
  size: number
  modified: number   // mtime ms
  content?: string   // Populated when needed
}

/**
 * Recursively scan a directory for markdown/text files, skipping symlinks.
 * Caps at 2000 files to prevent runaway scans.
 */
export async function scanMemoryFiles(
  baseDir: string,
  opts?: { extensions?: string[]; maxFiles?: number }
): Promise<MemoryFileInfo[]> {
  const extensions = opts?.extensions ?? ['.md', '.txt']
  const maxFiles = opts?.maxFiles ?? 2000
  const results: MemoryFileInfo[] = []

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxFiles) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) {
        try {
          const st = await stat(fullPath)
          if (st.size > 1_000_000) continue // skip >1MB
          results.push({
            path: relative(baseDir, fullPath),
            name: entry.name,
            size: st.size,
            modified: st.mtime.getTime(),
          })
        } catch {
          // skip unreadable
        }
      }
    }
  }

  await walk(baseDir)
  return results
}

// ─── Link graph ──────────────────────────────────────────────────

export interface LinkGraphNode {
  path: string
  name: string
  outgoing: string[]   // paths this file links to
  incoming: string[]   // paths that link to this file
  wikiLinks: WikiLink[]
  schema: SchemaBlock | null
}

export interface LinkGraph {
  nodes: Record<string, LinkGraphNode>
  totalFiles: number
  totalLinks: number
  orphans: string[]    // files with no links in or out
}

/**
 * Build a complete wiki-link graph from all markdown files in a directory.
 */
export async function buildLinkGraph(baseDir: string): Promise<LinkGraph> {
  const files = await scanMemoryFiles(baseDir, { extensions: ['.md'] })
  const nodes: Record<string, LinkGraphNode> = {}

  // Build a lookup: stem -> relative path
  const stemToPath = new Map<string, string>()
  for (const f of files) {
    const stem = basename(f.path, extname(f.path))
    // Prefer shorter paths for collision (closer to root = more canonical)
    if (!stemToPath.has(stem) || f.path.length < stemToPath.get(stem)!.length) {
      stemToPath.set(stem, f.path)
    }
  }

  // First pass: extract links from each file
  for (const f of files) {
    try {
      const content = await readFile(join(baseDir, f.path), 'utf-8')
      const wikiLinks = extractWikiLinks(content)
      const schema = extractSchema(content)
      const outgoing: string[] = []

      for (const link of wikiLinks) {
        const resolved = stemToPath.get(link.target)
        if (resolved && resolved !== f.path) {
          outgoing.push(resolved)
        }
      }

      nodes[f.path] = {
        path: f.path,
        name: f.name,
        outgoing: [...new Set(outgoing)],
        incoming: [],
        wikiLinks,
        schema,
      }
    } catch {
      // skip unreadable files
    }
  }

  // Second pass: compute incoming links
  let totalLinks = 0
  for (const node of Object.values(nodes)) {
    for (const target of node.outgoing) {
      if (nodes[target]) {
        nodes[target].incoming.push(node.path)
      }
      totalLinks++
    }
  }

  const orphans = Object.values(nodes)
    .filter((n) => n.incoming.length === 0 && n.outgoing.length === 0)
    .map((n) => n.path)

  return {
    nodes,
    totalFiles: Object.keys(nodes).length,
    totalLinks,
    orphans,
  }
}

// ─── Health diagnostics ──────────────────────────────────────────

export interface HealthCategory {
  name: string
  status: 'healthy' | 'warning' | 'critical'
  score: number       // 0-100
  issues: string[]
  suggestions: string[]
}

export interface HealthReport {
  overall: 'healthy' | 'warning' | 'critical'
  overallScore: number
  categories: HealthCategory[]
  generatedAt: number
}

export async function runHealthDiagnostics(baseDir: string): Promise<HealthReport> {
  const files = await scanMemoryFiles(baseDir, { extensions: ['.md'] })
  const graph = await buildLinkGraph(baseDir)
  const categories: HealthCategory[] = []

  await addSchemaCategory(baseDir, files, categories)
  addConnectivityCategory(graph, categories)
  addLinkIntegrityCategory(files, graph, categories)
  addFreshnessCategory(files, categories)
  addAtomicityCategory(files, categories)
  addNamingCategory(files, categories)
  addOrganizationCategory(files, categories)
  await addDescriptionCategory(baseDir, files, categories)

  const overallScore = categories.length > 0
    ? Math.round(categories.reduce((s, c) => s + c.score, 0) / categories.length)
    : 100
  const overall = overallScore >= 70 ? 'healthy' : overallScore >= 40 ? 'warning' : 'critical'

  return { overall, overallScore, categories, generatedAt: Date.now() }
}

async function addSchemaCategory(
  baseDir: string,
  files: MemoryFileInfo[],
  categories: HealthCategory[]
): Promise<void> {
  let filesWithSchema = 0
  let validSchemas = 0
  const schemaIssues: string[] = []

  for (const f of files) {
    try {
      const content = await readFile(join(baseDir, f.path), 'utf-8')
      const result = validateSchema(content)
      if (result.schema) {
        filesWithSchema++
        if (result.valid) validSchemas++
        else schemaIssues.push(`${f.path}: ${result.errors.join(', ')}`)
      }
    } catch { /* skip */ }
  }

  const score = filesWithSchema === 0 ? 100 : Math.round((validSchemas / filesWithSchema) * 100)
  categories.push({
    name: 'Schema Compliance',
    status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
    score,
    issues: schemaIssues.slice(0, 10),
    suggestions: filesWithSchema === 0
      ? ['Add _schema blocks to frontmatter for structured validation']
      : schemaIssues.length > 0
        ? ['Fix missing required fields in flagged files']
        : [],
  })
}

function addConnectivityCategory(graph: LinkGraph, categories: HealthCategory[]): void {
  const { totalFiles, orphans } = graph
  const orphanCount = orphans.length
  const connectedRatio = totalFiles > 0 ? (totalFiles - orphanCount) / totalFiles : 1
  const score = Math.round(connectedRatio * 100)
  categories.push({
    name: 'Connectivity',
    status: score >= 70 ? 'healthy' : score >= 40 ? 'warning' : 'critical',
    score,
    issues: orphanCount > 0
      ? [`${orphanCount} orphan file(s) with no [[wiki-links]] in or out`]
      : [],
    suggestions: orphanCount > 0
      ? ['Add [[wiki-links]] to connect orphan files', 'Run MOC generation to auto-create index files']
      : [],
  })
}

function addLinkIntegrityCategory(
  files: MemoryFileInfo[],
  graph: LinkGraph,
  categories: HealthCategory[]
): void {
  const stemToPath = new Map<string, string>()
  for (const f of files) {
    stemToPath.set(basename(f.path, extname(f.path)), f.path)
  }

  const brokenLinks: string[] = []
  for (const node of Object.values(graph.nodes)) {
    for (const link of node.wikiLinks) {
      if (!stemToPath.has(link.target)) {
        brokenLinks.push(`${node.path}:${link.line} -> [[${link.target}]]`)
      }
    }
  }

  const totalLinks = Object.values(graph.nodes).reduce((s, n) => s + n.wikiLinks.length, 0)
  const brokenRatio = totalLinks > 0 ? brokenLinks.length / totalLinks : 0
  const score = Math.round((1 - brokenRatio) * 100)
  categories.push({
    name: 'Link Integrity',
    status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
    score,
    issues: brokenLinks.slice(0, 10),
    suggestions: brokenLinks.length > 0 ? ['Create missing target files or fix link targets'] : [],
  })
}

function addFreshnessCategory(files: MemoryFileInfo[], categories: HealthCategory[]): void {
  const now = Date.now()
  const staleThreshold = 30 * 24 * 60 * 60 * 1000
  const staleFiles = files.filter((f) => now - f.modified > staleThreshold)
  const staleRatio = files.length > 0 ? staleFiles.length / files.length : 0
  const score = Math.round((1 - staleRatio * 0.5) * 100)
  categories.push({
    name: 'Freshness',
    status: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'critical',
    score,
    issues: staleFiles.length > 0
      ? [`${staleFiles.length} file(s) not updated in 30+ days`]
      : [],
    suggestions: staleFiles.length > 0
      ? ['Review stale files for relevance', 'Run a /reweave pass to update older notes']
      : [],
  })
}

function addAtomicityCategory(files: MemoryFileInfo[], categories: HealthCategory[]): void {
  const largeFiles = files.filter((f) => f.size > 10_000)
  const largeRatio = files.length > 0 ? largeFiles.length / files.length : 0
  const score = Math.round((1 - largeRatio * 0.8) * 100)
  categories.push({
    name: 'Atomicity',
    status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
    score,
    issues: largeFiles.length > 0
      ? [`${largeFiles.length} file(s) exceed 10KB — consider splitting into atomic notes`]
      : [],
    suggestions: largeFiles.length > 0
      ? ['Break large files into focused atomic notes with wiki-links between them']
      : [],
  })
}

function addNamingCategory(files: MemoryFileInfo[], categories: HealthCategory[]): void {
  const badNames: string[] = []
  for (const f of files) {
    const stem = basename(f.path, extname(f.path))
    if (/[A-Z]/.test(stem) && /\s/.test(stem)) badNames.push(f.path)
    if (/^(untitled|new-file|document|temp)/i.test(stem)) badNames.push(f.path)
  }
  const unique = [...new Set(badNames)]
  const score = files.length > 0
    ? Math.round(((files.length - unique.length) / files.length) * 100)
    : 100
  categories.push({
    name: 'Naming Conventions',
    status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
    score,
    issues: unique.slice(0, 10).map((p) => `Non-standard name: ${p}`),
    suggestions: unique.length > 0
      ? ['Use lowercase-kebab-case for file names', 'Avoid generic names like untitled or temp']
      : [],
  })
}

function addOrganizationCategory(files: MemoryFileInfo[], categories: HealthCategory[]): void {
  const rootFiles = files.filter((f) => !f.path.includes('/') && !f.path.includes('\\'))
  const rootRatio = files.length > 0 ? rootFiles.length / files.length : 0
  const score = rootRatio > 0.5 ? Math.round((1 - rootRatio) * 100) : 100
  categories.push({
    name: 'Organization',
    status: score >= 70 ? 'healthy' : score >= 40 ? 'warning' : 'critical',
    score,
    issues: rootRatio > 0.5
      ? [`${rootFiles.length}/${files.length} files at root level — organize into directories`]
      : [],
    suggestions: rootRatio > 0.5
      ? ['Create topic directories to group related notes', 'Use MOC files as directory indexes']
      : [],
  })
}

async function addDescriptionCategory(
  baseDir: string,
  files: MemoryFileInfo[],
  categories: HealthCategory[]
): Promise<void> {
  let withDescription = 0
  for (const f of files) {
    try {
      const content = await readFile(join(baseDir, f.path), 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (fmMatch && /description:\s*.+/.test(fmMatch[1])) {
        withDescription++
      }
    } catch { /* skip */ }
  }
  const score = files.length > 0
    ? Math.round((withDescription / files.length) * 100)
    : 100
  categories.push({
    name: 'Description Quality',
    status: score >= 60 ? 'healthy' : score >= 30 ? 'warning' : 'critical',
    score,
    issues: score < 60
      ? [`Only ${withDescription}/${files.length} files have description fields`]
      : [],
    suggestions: score < 60
      ? ['Add description: field to frontmatter for better discoverability']
      : [],
  })
}
