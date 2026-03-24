/**
 * Memory utilities — wiki-link extraction, schema validation, health diagnostics,
 * MOC generation. Inspired by Ars Contexta's knowledge graph primitives.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, extname, basename, dirname } from 'path'
import { logger } from './logger'

// ─── Wiki-link extraction ────────────────────────────────────────

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

export interface WikiLink {
  target: string   // The linked-to file stem (e.g. "my-note")
  display: string  // Display text (alias or target)
  line: number     // 1-based line number
}

export function extractWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null
    const re = new RegExp(WIKI_LINK_RE.source, WIKI_LINK_RE.flags)
    while ((match = re.exec(lines[i])) !== null) {
      links.push({
        target: match[1].trim(),
        display: (match[2] || match[1]).trim(),
        line: i + 1,
      })
    }
  }
  return links
}

// ─── Schema extraction & validation ──────────────────────────────

export interface SchemaBlock {
  type: string
  required?: string[]
  optional?: string[]
  [key: string]: unknown
}

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  schema: SchemaBlock | null
}

/**
 * Extract a _schema YAML block from markdown frontmatter.
 * Expects format:
 * ```
 * ---
 * _schema:
 *   type: note
 *   required: [title, tags]
 *   optional: [source]
 * ---
 * ```
 */
export function extractSchema(content: string): SchemaBlock | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null

  const fm = fmMatch[1]
  const schemaMatch = fm.match(/_schema:\s*\n((?:\s{2,}.+\n?)*)/)
  if (!schemaMatch) return null

  const block = schemaMatch[1]
  const schema: SchemaBlock = { type: 'unknown' }

  const typeMatch = block.match(/type:\s*(.+)/)
  if (typeMatch) schema.type = typeMatch[1].trim()

  const requiredMatch = block.match(/required:\s*\[([^\]]*)\]/)
  if (requiredMatch) {
    schema.required = requiredMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
  }

  const optionalMatch = block.match(/optional:\s*\[([^\]]*)\]/)
  if (optionalMatch) {
    schema.optional = optionalMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
  }

  return schema
}

/**
 * Validate frontmatter fields against a _schema block.
 */
export function validateSchema(content: string): SchemaValidationResult {
  const schema = extractSchema(content)
  if (!schema) return { valid: true, errors: [], schema: null }

  const errors: string[] = []
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) {
    return { valid: false, errors: ['No frontmatter found but _schema declared'], schema }
  }

  const fm = fmMatch[1]
  const fields = new Set<string>()
  for (const line of fm.split('\n')) {
    const fieldMatch = line.match(/^(\w[\w-]*):\s*/)
    if (fieldMatch) fields.add(fieldMatch[1])
  }

  if (schema.required) {
    for (const field of schema.required) {
      if (!fields.has(field)) {
        errors.push(`Missing required field: ${field}`)
      }
    }
  }

  return { valid: errors.length === 0, errors, schema }
}

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

  async function walk(dir: string) {
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
export async function buildLinkGraph(baseDir: string, existingFiles?: MemoryFileInfo[]): Promise<LinkGraph> {
  const files = existingFiles ?? await scanMemoryFiles(baseDir, { extensions: ['.md'] })
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

  // Find orphans (no incoming or outgoing links)
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
  const graph = await buildLinkGraph(baseDir, files)

  const categories: HealthCategory[] = []

  // 1. Schema compliance
  {
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

  // 2. Connectivity (wiki-link health)
  {
    const totalFiles = graph.totalFiles
    const orphanCount = graph.orphans.length
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
        ? [
            'Add [[wiki-links]] to connect orphan files',
            'Run MOC generation to auto-create index files',
          ]
        : [],
    })
  }

  // 3. Broken links
  {
    const brokenLinks: string[] = []
    const stemToPath = new Map<string, string>()
    for (const f of files) {
      stemToPath.set(basename(f.path, extname(f.path)), f.path)
    }
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
      suggestions: brokenLinks.length > 0
        ? ['Create missing target files or fix link targets']
        : [],
    })
  }

  // 4. Staleness (files not modified in 30+ days)
  {
    const now = Date.now()
    const staleThreshold = 30 * 24 * 60 * 60 * 1000
    const staleFiles = files.filter((f) => now - f.modified > staleThreshold)
    const staleRatio = files.length > 0 ? staleFiles.length / files.length : 0
    const score = Math.round((1 - staleRatio * 0.5) * 100) // half-weight staleness
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

  // 5. File size distribution (too large = not atomic)
  {
    const largeFiles = files.filter((f) => f.size > 10_000) // >10KB
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

  // 6. Naming conventions
  {
    const badNames: string[] = []
    for (const f of files) {
      const stem = basename(f.path, extname(f.path))
      if (/[A-Z]/.test(stem) && /\s/.test(stem)) {
        badNames.push(f.path)
      }
      if (/^(untitled|new-file|document|temp)/i.test(stem)) {
        badNames.push(f.path)
      }
    }
    const unique = [...new Set(badNames)]
    const score = files.length > 0 ? Math.round(((files.length - unique.length) / files.length) * 100) : 100
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

  // 7. Directory structure
  {
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

  // 8. Description quality (frontmatter description field)
  {
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
    const score = files.length > 0 ? Math.round((withDescription / files.length) * 100) : 100
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

  // Compute overall
  const overallScore = categories.length > 0
    ? Math.round(categories.reduce((s, c) => s + c.score, 0) / categories.length)
    : 100
  const overall = overallScore >= 70 ? 'healthy' : overallScore >= 40 ? 'warning' : 'critical'

  return {
    overall,
    overallScore,
    categories,
    generatedAt: Date.now(),
  }
}

// ─── MOC (Map of Content) generation ─────────────────────────────

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

    // Extract title from first H1 or filename
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

  // File tree (just paths)
  const fileTree = files.map((f) => f.path).sort()

  // Recent files (last 10 modified)
  const recentFiles = [...files]
    .sort((a, b) => b.modified - a.modified)
    .slice(0, 10)
    .map((f) => ({ path: f.path, modified: f.modified }))

  // Quick health summary (lightweight — just check orphans and staleness)
  const graph = await buildLinkGraph(baseDir, files)
  const now = Date.now()
  const staleThreshold = 30 * 24 * 60 * 60 * 1000
  const staleCount = files.filter((f) => now - f.modified > staleThreshold).length
  const orphanCount = graph.orphans.length

  const totalFiles = files.length
  const connectedRatio = totalFiles > 0 ? (totalFiles - orphanCount) / totalFiles : 1
  const staleRatio = totalFiles > 0 ? staleCount / totalFiles : 0
  const quickScore = Math.round(((connectedRatio + (1 - staleRatio)) / 2) * 100)
  const overall = quickScore >= 70 ? 'healthy' : quickScore >= 40 ? 'warning' : 'critical'

  // Maintenance signals
  const signals: string[] = []
  if (orphanCount > 5) signals.push(`${orphanCount} orphan files need wiki-links`)
  if (staleRatio > 0.3) signals.push(`${staleCount} files stale (30+ days)`)
  if (graph.totalLinks === 0 && totalFiles > 3) signals.push('No wiki-links found — consider adding [[connections]]')

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
 * Generate a "reflect" report — identify connection opportunities between files.
 */
export async function reflectPass(baseDir: string): Promise<ProcessingResult> {
  const graph = await buildLinkGraph(baseDir)
  const suggestions: string[] = []

  // Find files that share directory but aren't linked
  const dirGroups = new Map<string, string[]>()
  for (const node of Object.values(graph.nodes)) {
    const dir = dirname(node.path)
    if (!dirGroups.has(dir)) dirGroups.set(dir, [])
    dirGroups.get(dir)!.push(node.path)
  }

  for (const [dir, paths] of dirGroups) {
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const a = graph.nodes[paths[i]]
        const b = graph.nodes[paths[j]]
        if (a && b) {
          const linked = a.outgoing.includes(b.path) || b.outgoing.includes(a.path)
          if (!linked) {
            suggestions.push(
              `Consider linking [[${basename(a.path, extname(a.path))}]] <-> [[${basename(b.path, extname(b.path))}]] (same directory: ${dir})`
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
 * with context from newer files.
 */
export async function reweavePass(baseDir: string): Promise<ProcessingResult> {
  const files = await scanMemoryFiles(baseDir, { extensions: ['.md'] })
  const graph = await buildLinkGraph(baseDir)
  const now = Date.now()
  const staleThreshold = 14 * 24 * 60 * 60 * 1000 // 14 days
  const suggestions: string[] = []

  // Find stale files that have newer linked files
  for (const f of files) {
    if (now - f.modified > staleThreshold) {
      const node = graph.nodes[f.path]
      if (!node) continue

      // Check if any linked files are newer
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
