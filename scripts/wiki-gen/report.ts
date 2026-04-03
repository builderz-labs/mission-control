#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Wiki → Executive PowerPoint Report Generator
//
// Uses pptxgenjs (already in project deps) to build a structured .pptx
// from wiki pages and live system metrics extracted from the SQLite database.
//
// Usage:
//   npx tsx scripts/wiki-gen/report.ts                    # full report
//   npx tsx scripts/wiki-gen/report.ts --no-db            # skip DB metrics
//
// Output: wiki/report.pptx
// ---------------------------------------------------------------------------
import fs from 'fs'
import path from 'path'
import PptxGenJS from 'pptxgenjs'

const WIKI_DIR = path.resolve(__dirname, '..', '..', 'wiki')
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'ultron.db')
const OUT_FILE = path.join(WIKI_DIR, 'report.pptx')

// ---------------------------------------------------------------------------
// Void palette — matches the app's design system
// ---------------------------------------------------------------------------
const COLORS = {
  bg: '07090C',
  card: '0F141C',
  cyan: '22D3EE',
  mint: '34D399',
  amber: 'F59E0B',
  violet: 'A78BFA',
  red: 'EF4444',
  text: 'E2E8F0',
  muted: '94A3B8',
  border: '1E2A3A',
} as const

// ---------------------------------------------------------------------------
// DB metrics (optional — skip with --no-db or if db doesn't exist)
// ---------------------------------------------------------------------------

interface SystemMetrics {
  totalAgents: number
  activeAgents: number
  totalTasks: number
  completedTasks: number
  totalSessions: number
  recentErrors: number
}

function loadMetrics(skipDb: boolean): SystemMetrics | null {
  if (skipDb || !fs.existsSync(DB_PATH)) return null

  try {
    // Dynamic require so tsc doesn't fail if better-sqlite3 types are absent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(DB_PATH, { readonly: true })

    const agents = db.prepare('SELECT COUNT(*) as n FROM agents').get() as { n: number }
    const activeAgents = db.prepare(
      "SELECT COUNT(*) as n FROM agents WHERE status = 'active'"
    ).get() as { n: number }
    const tasks = db.prepare('SELECT COUNT(*) as n FROM tasks').get() as { n: number }
    const completed = db.prepare(
      "SELECT COUNT(*) as n FROM tasks WHERE status = 'completed'"
    ).get() as { n: number }
    const sessions = db.prepare('SELECT COUNT(*) as n FROM sessions').get() as { n: number }
    const errors = db.prepare(
      "SELECT COUNT(*) as n FROM tasks WHERE status = 'error' AND created_at > datetime('now', '-7 days')"
    ).get() as { n: number }

    db.close()

    return {
      totalAgents: agents.n,
      activeAgents: activeAgents.n,
      totalTasks: tasks.n,
      completedTasks: completed.n,
      totalSessions: sessions.n,
      recentErrors: errors.n,
    }
  } catch {
    // DB not accessible in this environment — gracefully skip
    return null
  }
}

// ---------------------------------------------------------------------------
// Wiki page loader
// ---------------------------------------------------------------------------

interface WikiPage {
  slug: string
  title: string
  summary: string   // first non-heading paragraph
  bullets: string[] // first 5 bullet points found
}

function extractSummary(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('|') && trimmed.length > 30) {
      return trimmed.slice(0, 220) + (trimmed.length > 220 ? '…' : '')
    }
  }
  return ''
}

function extractBullets(content: string): string[] {
  return content
    .split('\n')
    .filter(l => /^[-*]\s+/.test(l.trim()))
    .map(l => l.trim().replace(/^[-*]\s+/, '').slice(0, 120))
    .slice(0, 5)
}

function loadWikiPages(): WikiPage[] {
  if (!fs.existsSync(WIKI_DIR)) return []

  return fs.readdirSync(WIKI_DIR)
    .filter(f => {
      if (!f.endsWith('.md')) return false
      return !['slides.md', 'lint-report.md', 'STYLE_GUIDE.md', 'Home.md'].includes(f)
    })
    .sort()
    .map(f => {
      const content = fs.readFileSync(path.join(WIKI_DIR, f), 'utf8')
      const titleMatch = content.match(/^#\s+(.+)$/m)
      return {
        slug: f.replace('.md', ''),
        title: titleMatch?.[1] ?? f.replace('.md', ''),
        summary: extractSummary(content),
        bullets: extractBullets(content),
      }
    })
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

function addTitleSlide(prs: PptxGenJS): void {
  const slide = prs.addSlide()
  slide.background = { color: COLORS.bg }

  // Accent bar
  slide.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: 0.08,
    fill: { color: COLORS.cyan },
    line: { color: COLORS.cyan },
  })

  slide.addText('ULTRON MISSION CONTROL', {
    x: 0.6, y: 1.2, w: 8.8, h: 0.9,
    fontSize: 36, bold: true, color: COLORS.cyan,
    fontFace: 'Courier New',
  })

  slide.addText('System Documentation Report', {
    x: 0.6, y: 2.1, w: 8.8, h: 0.5,
    fontSize: 18, color: COLORS.text, fontFace: 'Courier New',
  })

  slide.addText(`Generated: ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`, {
    x: 0.6, y: 4.8, w: 8.8, h: 0.4,
    fontSize: 11, color: COLORS.muted, fontFace: 'Courier New',
  })

  // Bottom bar
  slide.addShape(prs.ShapeType.rect, {
    x: 0, y: 5.35, w: '100%', h: 0.08,
    fill: { color: COLORS.border },
    line: { color: COLORS.border },
  })
}

function addMetricsSlide(prs: PptxGenJS, metrics: SystemMetrics): void {
  const slide = prs.addSlide()
  slide.background = { color: COLORS.bg }

  slide.addText('System Metrics', {
    x: 0.6, y: 0.4, w: 8.8, h: 0.6,
    fontSize: 24, bold: true, color: COLORS.cyan, fontFace: 'Courier New',
  })

  const completionRate = metrics.totalTasks > 0
    ? Math.round((metrics.completedTasks / metrics.totalTasks) * 100)
    : 0

  const statRows = [
    ['Total Agents', String(metrics.totalAgents), COLORS.text],
    ['Active Agents', String(metrics.activeAgents), COLORS.mint],
    ['Total Tasks', String(metrics.totalTasks), COLORS.text],
    ['Completion Rate', `${completionRate}%`, completionRate >= 80 ? COLORS.mint : COLORS.amber],
    ['Sessions', String(metrics.totalSessions), COLORS.text],
    ['Errors (7d)', String(metrics.recentErrors), metrics.recentErrors > 0 ? COLORS.red : COLORS.mint],
  ]

  statRows.forEach(([label, value, color], i) => {
    const y = 1.2 + i * 0.62
    slide.addText(label, {
      x: 0.6, y, w: 4, h: 0.5,
      fontSize: 14, color: COLORS.muted, fontFace: 'Courier New',
    })
    slide.addText(value, {
      x: 4.8, y, w: 4, h: 0.5,
      fontSize: 20, bold: true, color, fontFace: 'Courier New',
    })
    // Divider
    slide.addShape(prs.ShapeType.line, {
      x: 0.6, y: y + 0.52, w: 8.8, h: 0,
      line: { color: COLORS.border, width: 0.5 },
    })
  })
}

function addWikiSlide(prs: PptxGenJS, page: WikiPage, index: number): void {
  const slide = prs.addSlide()
  slide.background = { color: COLORS.bg }

  // Index badge
  slide.addText(String(index + 1).padStart(2, '0'), {
    x: 8.8, y: 0.2, w: 0.8, h: 0.5,
    fontSize: 10, color: COLORS.muted, fontFace: 'Courier New', align: 'right',
  })

  slide.addText(page.title, {
    x: 0.6, y: 0.3, w: 8.2, h: 0.65,
    fontSize: 22, bold: true, color: COLORS.cyan, fontFace: 'Courier New',
  })

  if (page.summary) {
    slide.addText(page.summary, {
      x: 0.6, y: 1.05, w: 8.8, h: 0.65,
      fontSize: 11, color: COLORS.muted, fontFace: 'Courier New', italic: true,
    })
  }

  // Bullet points
  if (page.bullets.length > 0) {
    const bulletItems = page.bullets.map(b => ({
      text: b,
      options: { bullet: { code: '25B8' }, color: COLORS.text, fontSize: 12 },
    }))

    slide.addText(bulletItems, {
      x: 0.6, y: 1.8, w: 8.8, h: 3.2,
      fontFace: 'Courier New',
      paraSpaceAfter: 6,
    })
  }

  // Slug tag
  slide.addText(page.slug, {
    x: 0.6, y: 5.05, w: 4, h: 0.3,
    fontSize: 9, color: COLORS.border, fontFace: 'Courier New',
  })
}

function addClosingSlide(prs: PptxGenJS, pageCount: number): void {
  const slide = prs.addSlide()
  slide.background = { color: COLORS.bg }

  slide.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: 0.08,
    fill: { color: COLORS.cyan }, line: { color: COLORS.cyan },
  })

  slide.addText('Documentation Complete', {
    x: 0.6, y: 1.6, w: 8.8, h: 0.7,
    fontSize: 28, bold: true, color: COLORS.cyan, fontFace: 'Courier New',
  })

  slide.addText([
    { text: `${pageCount} wiki pages covered\n`, options: { color: COLORS.text, fontSize: 14 } },
    { text: 'pnpm wiki:generate  ', options: { color: COLORS.muted, fontSize: 12 } },
    { text: '→ regenerate content\n', options: { color: COLORS.muted, fontSize: 12 } },
    { text: 'pnpm wiki:qa        ', options: { color: COLORS.muted, fontSize: 12 } },
    { text: '→ Q&A agent\n', options: { color: COLORS.muted, fontSize: 12 } },
    { text: 'pnpm wiki:search    ', options: { color: COLORS.muted, fontSize: 12 } },
    { text: '→ keyword search', options: { color: COLORS.muted, fontSize: 12 } },
  ], {
    x: 0.6, y: 2.5, w: 8.8, h: 2.5,
    fontFace: 'Courier New',
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const skipDb = process.argv.includes('--no-db')
  const pages = loadWikiPages()

  console.log(`\n📑  Wiki → PPTX Report Generator`)
  console.log(`   Pages  : ${pages.length}`)
  console.log(`   DB     : ${skipDb ? 'skipped (--no-db)' : DB_PATH}`)
  console.log(`   Output : wiki/report.pptx\n`)

  const metrics = loadMetrics(skipDb)
  if (metrics) {
    console.log(`   Metrics: ${metrics.totalAgents} agents, ${metrics.totalTasks} tasks, ${metrics.totalSessions} sessions`)
  }

  const prs = new PptxGenJS()
  prs.layout = 'LAYOUT_WIDE'   // 13.33" × 7.5"
  prs.author = 'Ultron Mission Control'
  prs.company = 'Mantu Group'
  prs.subject = 'System Documentation'
  prs.title = 'Ultron Mission Control — Documentation Report'

  // Build slides
  process.stdout.write('  Building slides')
  addTitleSlide(prs)
  process.stdout.write('.')

  if (metrics) {
    addMetricsSlide(prs, metrics)
    process.stdout.write('.')
  }

  pages.forEach((page, i) => {
    addWikiSlide(prs, page, i)
    process.stdout.write('.')
  })

  addClosingSlide(prs, pages.length)
  process.stdout.write(' ✓\n')

  await prs.writeFile({ fileName: OUT_FILE })

  console.log(`\n✨  Report written to wiki/report.pptx`)
  console.log(`   ${1 + (metrics ? 1 : 0) + pages.length + 1} slides total\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
