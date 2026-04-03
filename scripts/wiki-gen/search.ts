#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Wiki Search CLI — keyword search across all wiki pages
//
// Usage:
//   npx tsx scripts/wiki-gen/search.ts "gateway"
//   npx tsx scripts/wiki-gen/search.ts "API key" --context 3
//
// No LLM needed — pure grep-style search with ranked results.
// ---------------------------------------------------------------------------
import fs from 'fs'
import path from 'path'

const WIKI_DIR = path.resolve(__dirname, '..', '..', 'wiki')
const CONTEXT_LINES = parseInt(
  process.argv.find((a, i) => process.argv[i - 1] === '--context') ?? '2',
  10
)

interface SearchResult {
  slug: string
  lineNo: number
  line: string
  context: string[]
  score: number
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function searchPage(slug: string, content: string, query: string): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const lines = content.split('\n')
  const results: SearchResult[] = []

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase()
    const matchCount = terms.filter(t => lower.includes(t)).length
    if (matchCount === 0) continue

    const start = Math.max(0, i - CONTEXT_LINES)
    const end = Math.min(lines.length - 1, i + CONTEXT_LINES)
    results.push({
      slug,
      lineNo: i + 1,
      line: lines[i],
      context: lines.slice(start, end + 1),
      score: matchCount,
    })
  }

  return results
}

function highlight(text: string, query: string): string {
  const terms = query.split(/\s+/).filter(Boolean)
  let result = text
  for (const term of terms) {
    // Case-insensitive replace with underline marker (terminal bold)
    result = result.replace(
      new RegExp(term, 'gi'),
      match => `\x1b[1;33m${match}\x1b[0m`
    )
  }
  return result
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Strip --flag and its following value so they don't pollute the query
  const args = process.argv.slice(2)
  const flagValues = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--context' && args[i + 1] !== undefined) {
      flagValues.add(args[i + 1])
    }
  }
  const query = args
    .filter(a => !a.startsWith('--') && !flagValues.has(a))
    .join(' ')
    .trim()

  if (!query) {
    console.error('Usage: npx tsx scripts/wiki-gen/search.ts <query> [--context N]')
    process.exit(1)
  }

  if (!fs.existsSync(WIKI_DIR)) {
    console.error('Wiki directory not found. Run pnpm wiki:generate first.')
    process.exit(1)
  }

  const pages = fs.readdirSync(WIKI_DIR)
    .filter(f => f.endsWith('.md') && f !== 'lint-report.md')
    .sort()

  const allResults: SearchResult[] = []

  for (const f of pages) {
    const slug = f.replace('.md', '')
    const content = fs.readFileSync(path.join(WIKI_DIR, f), 'utf8')
    allResults.push(...searchPage(slug, content, query))
  }

  if (allResults.length === 0) {
    console.log(`No results for: "${query}"`)
    return
  }

  // Sort by score descending, then by page name
  allResults.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))

  console.log(`\n🔎  Results for: "${query}" (${allResults.length} match${allResults.length === 1 ? '' : 'es'})\n`)

  // Group by slug
  const bySlug = new Map<string, SearchResult[]>()
  for (const r of allResults) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, [])
    bySlug.get(r.slug)!.push(r)
  }

  for (const [slug, results] of bySlug) {
    console.log(`\x1b[1;36m📄  ${slug}.md\x1b[0m  (${results.length} match${results.length === 1 ? '' : 'es'})`)
    for (const r of results.slice(0, 5)) {
      console.log(`  \x1b[2mL${r.lineNo}\x1b[0m  ${highlight(r.line.trim(), query)}`)
    }
    if (results.length > 5) {
      console.log(`  \x1b[2m... and ${results.length - 5} more\x1b[0m`)
    }
  }

  console.log()
}

main()
