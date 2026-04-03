// ---------------------------------------------------------------------------
// Wiki Generator — source file indexer
// Reads files from the repo and wiki/raw/, returns SourceFile[]
// ---------------------------------------------------------------------------
import fs from 'fs'
import path from 'path'
import { type SourceFile } from './types'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

// Max bytes we'll read per file before truncating (keep context window sane)
const MAX_FILE_BYTES = 40_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) return readDirectory(filePath)
    const raw = fs.readFileSync(filePath)
    const text = raw.slice(0, MAX_FILE_BYTES).toString('utf8')
    return raw.length > MAX_FILE_BYTES
      ? text + `\n\n[...truncated at ${MAX_FILE_BYTES} bytes]`
      : text
  } catch {
    return null
  }
}

/** For directory paths, collect all *.ts and *.tsx files up to 6 files */
function readDirectory(dirPath: string): string {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && /\.(ts|tsx|md)$/.test(e.name))
      .slice(0, 6)
    return files
      .map(e => {
        const content = readSafe(path.join(dirPath, e.name))
        return content ? `// --- ${e.name} ---\n${content}` : ''
      })
      .filter(Boolean)
      .join('\n\n')
  } catch {
    return ''
  }
}

function resolveSpec(spec: string): string {
  // Absolute path → use as-is; relative → resolve from REPO_ROOT
  if (path.isAbsolute(spec)) return spec
  return path.join(REPO_ROOT, spec)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load source files for a given list of path specs.
 * Each spec may be a file path or a directory (reads top-level *.ts/*.md files).
 */
export function loadSources(pathSpecs: string[], weight = 5): SourceFile[] {
  const results: SourceFile[] = []

  for (const spec of pathSpecs) {
    const abs = resolveSpec(spec)
    const content = readSafe(abs)
    if (!content || content.trim().length === 0) continue

    results.push({
      path: spec,
      content,
      weight,
    })
  }

  return results
}

/**
 * Load all *.md files from wiki/raw/ as supplementary raw context.
 * These are operator-authored reference documents, weight=8.
 */
export function loadRawSources(): SourceFile[] {
  const rawDir = path.join(REPO_ROOT, 'wiki', 'raw')
  if (!fs.existsSync(rawDir)) return []

  const files = fs.readdirSync(rawDir)
    .filter(f => /\.(md|txt|json)$/.test(f))
    .sort()

  return files.flatMap(f => {
    const content = readSafe(path.join(rawDir, f))
    if (!content) return []
    return [{ path: `wiki/raw/${f}`, content, weight: 8 }]
  })
}

/**
 * Build the full source context string to embed in the Claude prompt.
 * Sources are sorted by weight descending, then formatted as fenced code blocks.
 */
export function buildContext(sources: SourceFile[]): string {
  return [...sources]
    .sort((a, b) => b.weight - a.weight)
    .map(s => `### Source: ${s.path}\n\`\`\`\n${s.content}\n\`\`\``)
    .join('\n\n')
}
