#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Wiki Lint+Heal — finds inconsistencies, imputes missing info, suggests
// new articles via web search awareness
//
// Usage:
//   npx tsx scripts/wiki-gen/lint-heal.ts             # analyse only
//   npx tsx scripts/wiki-gen/lint-heal.ts --fix       # analyse + rewrite bad pages
//
// Output: lint-report.md written to wiki/
// ---------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

const client = new Anthropic()
const MODEL = process.env.WIKI_MODEL ?? 'claude-haiku-4-5'
const WIKI_DIR = path.resolve(__dirname, '..', '..', 'wiki')

const SYSTEM_PROMPT = `You are a technical documentation quality reviewer for Ultron Mission Control.
Analyse the provided wiki pages and produce a structured lint report.`

// ---------------------------------------------------------------------------
// Load wiki pages as an array of {slug, content} objects
// ---------------------------------------------------------------------------

interface WikiPage {
  slug: string
  content: string
  path: string
}

function loadWikiPages(): WikiPage[] {
  if (!fs.existsSync(WIKI_DIR)) return []
  return fs.readdirSync(WIKI_DIR)
    .filter(f => f.endsWith('.md') && f !== 'lint-report.md')
    .sort()
    .map(f => ({
      slug: f.replace('.md', ''),
      content: fs.readFileSync(path.join(WIKI_DIR, f), 'utf8'),
      path: path.join(WIKI_DIR, f),
    }))
}

// ---------------------------------------------------------------------------
// Analyse all pages in a single Claude call
// ---------------------------------------------------------------------------

async function analysePages(pages: WikiPage[]): Promise<string> {
  const pagesContext = pages
    .map(p => `=== ${p.slug} ===\n${p.content}`)
    .join('\n\n---\n\n')

  const prompt = `Review these wiki pages and produce a lint report in markdown with these sections:

## 1. Inconsistencies
List factual contradictions or terminology mismatches between pages.

## 2. Missing Information
List important topics mentioned in one page but not covered anywhere, with suggested page for coverage.

## 3. Broken Cross-References
List any "See: [[PageName]]" or markdown links that reference non-existent pages.

## 4. Quality Issues
Per-page issues: outdated info, missing code examples, unclear sections, missing "Last reviewed" dates.

## 5. Suggested New Articles
Topics that appear repeatedly but lack a dedicated page (e.g., Troubleshooting, Multi-Tenant Setup, Agent Development).

## 6. Summary
Counts: pages reviewed, issues found by severity (critical/major/minor).

Wiki pages to review:

${pagesContext}`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content[0]
  return block.type === 'text' ? block.text : ''
}

// ---------------------------------------------------------------------------
// Heal: rewrite a page that has critical issues
// ---------------------------------------------------------------------------

async function healPage(page: WikiPage, issues: string): Promise<void> {
  const prompt = `The following wiki page has quality issues. Rewrite it to fix the problems
while preserving all accurate information.

Issues to fix:
${issues}

Current page content:
${page.content}`

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are a technical writer. Rewrite the provided documentation to fix the stated issues. Output only the rewritten markdown.',
    messages: [{ role: 'user', content: prompt }],
  })

  const chunks: string[] = []
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      chunks.push(event.delta.text)
    }
  }

  const healed = chunks.join('')
  if (healed.trim()) {
    fs.writeFileSync(page.path, healed, 'utf8')
    console.log(`  🔧  Healed: ${page.slug}.md`)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required')
    process.exit(1)
  }

  const fixMode = process.argv.includes('--fix')
  const pages = loadWikiPages()

  if (pages.length === 0) {
    console.error('No wiki pages found. Run pnpm wiki:generate first.')
    process.exit(1)
  }

  console.log(`\n🔍  Linting ${pages.length} wiki page(s)...`)

  const report = await analysePages(pages)
  const reportPath = path.join(WIKI_DIR, 'lint-report.md')
  const header = `# Wiki Lint Report\n\nGenerated: ${new Date().toISOString()}\n\n`
  fs.writeFileSync(reportPath, header + report, 'utf8')
  console.log(`\n📋  Report written to wiki/lint-report.md`)
  console.log('\n' + report)

  if (fixMode) {
    // Simple heuristic: heal pages that the report mentions by slug with "critical" nearby
    const criticalPattern = /critical.*?`?(\w[\w-]+)`?|`?(\w[\w-]+)`?.*?critical/gi
    const matches = [...report.matchAll(criticalPattern)]
    const criticalSlugs = new Set(
      matches.flatMap(m => [m[1], m[2]]).filter(Boolean)
    )

    for (const page of pages) {
      if (criticalSlugs.has(page.slug)) {
        const issueLines = report
          .split('\n')
          .filter(l => l.toLowerCase().includes(page.slug.toLowerCase()))
          .join('\n')
        await healPage(page, issueLines)
      }
    }
  }

  console.log('\n✨  Lint complete')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
