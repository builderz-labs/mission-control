import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

interface BrainEntry {
  date: string
  dayOfWeek: string
  time: string
  title: string
  source?: string
  insight: string
  whyItMatters?: string
  tags: string[]
  action?: string
  related?: string
}

interface DayFile {
  date: string
  dayOfWeek: string
  entries: BrainEntry[]
  entryCount: number
}

const BRAIN_DIR = config.eddieBrainDir
const ENTRIES_DIR = BRAIN_DIR ? join(BRAIN_DIR, 'entries') : ''

function parseDayFile(content: string, filename: string): DayFile {
  const date = filename.replace('.md', '')
  const entries: BrainEntry[] = []

  // Parse the H1 header for day of week
  const h1Match = content.match(/^#\s+.*?(\w+day)\)?\s*$/m)
  const dayOfWeek = h1Match ? h1Match[1] : ''

  // Split on entry headers: ### TIME — Title
  const blocks = content.split(/^### /m).slice(1)

  for (const block of blocks) {
    const lines = block.split('\n')
    const headerLine = lines[0] || ''

    // Parse: "9:03 AM ET — Magnus Carlsen on Intuition vs. Analysis"
    const headerMatch = headerLine.match(/^([\d:]+\s*(?:AM|PM)\s*ET)\s*—\s*(.+)/)
    if (!headerMatch) continue

    const time = headerMatch[1]
    const title = headerMatch[2].trim()

    let source = ''
    let insight = ''
    let whyItMatters = ''
    const tags: string[] = []
    let action = ''
    let related = ''

    for (const line of lines.slice(1)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('**Source:**')) {
        source = trimmed.replace('**Source:**', '').trim()
      } else if (trimmed.startsWith('**Insight:**')) {
        insight = trimmed.replace('**Insight:**', '').trim()
      } else if (trimmed.startsWith('**Why this matters:**')) {
        whyItMatters = trimmed.replace('**Why this matters:**', '').trim()
      } else if (trimmed.startsWith('**Tags:**')) {
        const tagStr = trimmed.replace('**Tags:**', '').trim()
        const tagMatches = tagStr.match(/#[a-z][a-z0-9-]*/g)
        if (tagMatches) tags.push(...tagMatches)
      } else if (trimmed.startsWith('**Action:**')) {
        action = trimmed.replace('**Action:**', '').trim()
      } else if (trimmed.startsWith('**Related:**')) {
        related = trimmed.replace('**Related:**', '').trim()
      }
    }

    entries.push({
      date,
      dayOfWeek,
      time,
      title,
      source: source || undefined,
      insight,
      whyItMatters: whyItMatters || undefined,
      tags,
      action: action || undefined,
      related: related || undefined,
    })
  }

  return { date, dayOfWeek, entries, entryCount: entries.length }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    if (!ENTRIES_DIR) {
      return NextResponse.json({ days: [], entries: [], total: 0, allTags: [] })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'entries'
    const search = searchParams.get('search')?.toLowerCase() || ''
    const tag = searchParams.get('tag') || ''
    const date = searchParams.get('date') || ''

    // Read all day files
    let files: string[]
    try {
      const dirItems = await readdir(ENTRIES_DIR)
      files = dirItems.filter((f) => f.endsWith('.md')).sort().reverse()
    } catch {
      return NextResponse.json({ days: [], entries: [], total: 0, allTags: [] })
    }

    if (action === 'dates') {
      // Return list of dates with entry counts
      const days: Array<{ date: string; dayOfWeek: string; entryCount: number }> = []
      for (const file of files) {
        try {
          const content = await readFile(join(ENTRIES_DIR, file), 'utf-8')
          const day = parseDayFile(content, file)
          days.push({ date: day.date, dayOfWeek: day.dayOfWeek, entryCount: day.entryCount })
        } catch {
          // skip unreadable files
        }
      }
      return NextResponse.json({ days })
    }

    if (action === 'tags') {
      // Return all tags with counts
      const tagCounts: Record<string, number> = {}
      for (const file of files) {
        try {
          const content = await readFile(join(ENTRIES_DIR, file), 'utf-8')
          const day = parseDayFile(content, file)
          for (const entry of day.entries) {
            for (const t of entry.tags) {
              tagCounts[t] = (tagCounts[t] || 0) + 1
            }
          }
        } catch {
          // skip
        }
      }
      const tags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => ({ tag, count }))
      return NextResponse.json({ tags })
    }

    if (action === 'raw' && date) {
      // Return raw markdown for a specific date
      try {
        const content = await readFile(join(ENTRIES_DIR, `${date}.md`), 'utf-8')
        return NextResponse.json({ date, content })
      } catch {
        return NextResponse.json({ error: 'Date not found' }, { status: 404 })
      }
    }

    // Default: return parsed entries
    const allEntries: BrainEntry[] = []
    const allTags = new Set<string>()

    // If specific date, only load that file
    const targetFiles = date ? files.filter((f) => f === `${date}.md`) : files

    for (const file of targetFiles) {
      try {
        const content = await readFile(join(ENTRIES_DIR, file), 'utf-8')
        const day = parseDayFile(content, file)
        for (const entry of day.entries) {
          entry.tags.forEach((t) => allTags.add(t))
          allEntries.push(entry)
        }
      } catch {
        // skip
      }
    }

    // Apply search filter
    let filtered = allEntries
    if (search) {
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(search) ||
          e.insight.toLowerCase().includes(search) ||
          (e.source && e.source.toLowerCase().includes(search)) ||
          (e.whyItMatters && e.whyItMatters.toLowerCase().includes(search)) ||
          e.tags.some((t) => t.toLowerCase().includes(search))
      )
    }
    if (tag) {
      const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`
      filtered = filtered.filter((e) => e.tags.includes(normalizedTag))
    }

    // Also read topics list
    let topics: string[] = []
    if (BRAIN_DIR) {
      try {
        const topicFiles = await readdir(join(BRAIN_DIR, 'topics'))
        topics = topicFiles.filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', ''))
      } catch {
        // no topics yet
      }
    }

    return NextResponse.json({
      entries: filtered,
      total: filtered.length,
      allTags: [...allTags].sort(),
      topics,
    })
  } catch (error) {
    logger.error({ err: error }, "Eddie's Brain API error")
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
