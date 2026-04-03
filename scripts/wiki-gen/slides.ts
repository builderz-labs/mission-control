#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Wiki → Marp Slide Deck Generator
//
// Reads wiki/*.md pages and asks Claude to distil each one into a tight
// Marp slide deck, then concatenates all decks into a single presentation.
//
// Usage:
//   npx tsx scripts/wiki-gen/slides.ts                    # all articles → wiki/slides.md
//   npx tsx scripts/wiki-gen/slides.ts Architecture FAQ   # selective
//   WIKI_MODEL=claude-sonnet-4-5 npx tsx scripts/wiki-gen/slides.ts
//
// Output:  wiki/slides.md  (Marp-compatible markdown)
// Render:  npx @marp-team/marp-cli wiki/slides.md --html --output wiki/slides.html
// ---------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

const client = new Anthropic()
const MODEL = process.env.WIKI_MODEL ?? 'claude-haiku-4-5'
const WIKI_DIR = path.resolve(__dirname, '..', '..', 'wiki')
const OUT_FILE = path.join(WIKI_DIR, 'slides.md')

// ---------------------------------------------------------------------------
// Marp front-matter written once at the top of the combined deck
// ---------------------------------------------------------------------------
const MARP_HEADER = `---
marp: true
theme: default
paginate: true
backgroundColor: '#07090C'
color: '#E2E8F0'
style: |
  section {
    font-family: 'JetBrains Mono', monospace, sans-serif;
    background-color: #07090C;
    color: #E2E8F0;
  }
  h1, h2 { color: #22D3EE; }
  h3 { color: #34D399; }
  code { background: #0F141C; color: #22D3EE; border-radius: 4px; padding: 2px 6px; }
  pre { background: #0F141C; border-left: 3px solid #22D3EE; padding: 16px; }
  strong { color: #F59E0B; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #0F141C; color: #22D3EE; padding: 8px; }
  td { border: 1px solid #1E2A3A; padding: 8px; }
---

# Ultron Mission Control
## System Documentation — Overview Deck

Generated: ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}

---

`

// ---------------------------------------------------------------------------
// System prompt for slide generation
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a technical presenter creating Marp slide decks.
Convert the provided documentation page into a concise Marp slide deck.

Rules:
- Use --- as slide separator (never use front-matter again — it's already set)
- Maximum 6 slides per article (title slide + up to 5 content slides)
- Each slide: 1 clear heading, 3-6 bullet points or a small code block
- Lead with the most important insight on each slide
- Use \`backtick code\` for commands, file paths, config keys
- Fenced code blocks for multi-line examples (keep them ≤8 lines)
- No filler words. Every bullet must carry information.
- Output only the slide markdown — no preamble, no commentary`

// ---------------------------------------------------------------------------
// Load wiki pages
// ---------------------------------------------------------------------------

interface WikiPage {
  slug: string
  content: string
}

function loadPages(slugFilter: string[]): WikiPage[] {
  if (!fs.existsSync(WIKI_DIR)) {
    throw new Error(`Wiki directory not found: ${WIKI_DIR}. Run pnpm wiki:generate first.`)
  }

  return fs.readdirSync(WIKI_DIR)
    .filter(f => {
      if (!f.endsWith('.md')) return false
      if (['slides.md', 'lint-report.md', 'STYLE_GUIDE.md', 'Home.md'].includes(f)) return false
      if (slugFilter.length === 0) return true
      return slugFilter.includes(f.replace('.md', ''))
    })
    .sort()
    .map(f => ({
      slug: f.replace('.md', ''),
      content: fs.readFileSync(path.join(WIKI_DIR, f), 'utf8'),
    }))
}

// ---------------------------------------------------------------------------
// Generate slides for one page via streaming
// ---------------------------------------------------------------------------

async function generateSlides(page: WikiPage): Promise<string> {
  process.stdout.write(`  📊  Generating slides for ${page.slug}`)

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Convert this wiki page into a Marp slide deck (max 6 slides):\n\n${page.content}`,
    }],
  })

  const chunks: string[] = []
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      chunks.push(event.delta.text)
      process.stdout.write('.')
    }
  }

  process.stdout.write(' ✓\n')
  return chunks.join('')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required')
    process.exit(1)
  }

  const slugFilter = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const pages = loadPages(slugFilter)

  if (pages.length === 0) {
    console.error('No wiki pages found. Run pnpm wiki:generate first.')
    process.exit(1)
  }

  console.log(`\n📊  Wiki → Marp Slide Generator`)
  console.log(`   Pages  : ${pages.map(p => p.slug).join(', ')}`)
  console.log(`   Model  : ${MODEL}`)
  console.log(`   Output : wiki/slides.md\n`)

  const sections: string[] = [MARP_HEADER]

  for (const page of pages) {
    const slides = await generateSlides(page)
    // Ensure the section starts cleanly and ends with a separator
    const cleaned = slides.trim()
    sections.push(cleaned + '\n\n---\n\n')
  }

  // Closing slide
  sections.push(`# Thank You\n\n**Ultron Mission Control** — Autonomous Agent Orchestration\n\n_Documentation generated by pnpm wiki:generate_\n`)

  fs.writeFileSync(OUT_FILE, sections.join(''), 'utf8')

  console.log(`\n✨  Slides written to wiki/slides.md`)
  console.log(`   Render: npx @marp-team/marp-cli wiki/slides.md --html --output wiki/slides.html`)
  console.log(`   PDF:    npx @marp-team/marp-cli wiki/slides.md --pdf --output wiki/slides.pdf\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
