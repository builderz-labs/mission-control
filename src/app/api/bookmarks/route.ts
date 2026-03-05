import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

interface Bookmark {
  id: number
  date: string
  time: string
  type: string
  url: string
  title: string
  summary: string
  tags: string[]
  action?: string
}

const BOOKMARKS_PATH = config.memoryDir
  ? join(config.memoryDir, 'bookmarks.md')
  : ''

function parseBookmarks(content: string): Bookmark[] {
  const bookmarks: Bookmark[] = []
  // Split on entry headers: ### YYYY-MM-DD ...
  const blocks = content.split(/^### /m).slice(1)

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const lines = block.split('\n')
    const headerLine = lines[0] || ''

    // Parse header: "2026-03-04 8:03 PM ET — tweet"
    const headerMatch = headerLine.match(
      /^(\d{4}-\d{2}-\d{2})(?:\s+([\d:]+\s*(?:AM|PM)\s*ET))?\s*—\s*(\S+)/i
    )
    if (!headerMatch) continue

    const date = headerMatch[1]
    const time = headerMatch[2] || ''
    const type = headerMatch[3]

    let url = ''
    let title = ''
    let summary = ''
    const tags: string[] = []
    let action = ''

    for (const line of lines.slice(1)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('**URL:**')) {
        url = trimmed.replace('**URL:**', '').trim()
      } else if (trimmed.startsWith('**Title:**')) {
        title = trimmed.replace('**Title:**', '').trim()
      } else if (trimmed.startsWith('**Summary:**')) {
        summary = trimmed.replace('**Summary:**', '').trim()
      } else if (trimmed.startsWith('**Tags:**')) {
        const tagStr = trimmed.replace('**Tags:**', '').trim()
        const tagMatches = tagStr.match(/#[a-z][a-z0-9-]*/g)
        if (tagMatches) tags.push(...tagMatches)
      } else if (trimmed.startsWith('**Action:**')) {
        action = trimmed.replace('**Action:**', '').trim()
      }
    }

    bookmarks.push({
      id: i + 1,
      date,
      time,
      type,
      url,
      title,
      summary,
      tags,
      action: action || undefined,
    })
  }

  return bookmarks
}

function bookmarksToMarkdown(bookmarks: Bookmark[]): string {
  const header = `# Bookmarks Database

Eddie's saved links — structured, searchable, timestamped.

Format: \`### YYYY-MM-DD HH:MM PM ET — type\` header, then URL, title, summary, tags.
Search: \`grep -i "keyword" memory/bookmarks.md\` or use Mission Control UI.
`

  const entries = bookmarks.map((b) => {
    const timeStr = b.time ? ` ${b.time}` : ''
    let entry = `\n---\n\n### ${b.date}${timeStr} — ${b.type}\n`
    entry += `\n**URL:** ${b.url}`
    entry += `\n**Title:** ${b.title}`
    entry += `\n**Summary:** ${b.summary}`
    entry += `\n**Tags:** ${b.tags.join(' ')}`
    if (b.action) entry += `\n**Action:** ${b.action}`
    return entry
  })

  return header + entries.join('\n')
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    if (!BOOKMARKS_PATH) {
      return NextResponse.json({ bookmarks: [], total: 0 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.toLowerCase() || ''
    const type = searchParams.get('type') || ''
    const tag = searchParams.get('tag') || ''
    const date = searchParams.get('date') || ''

    let content: string
    try {
      content = await readFile(BOOKMARKS_PATH, 'utf-8')
    } catch {
      return NextResponse.json({ bookmarks: [], total: 0 })
    }

    let bookmarks = parseBookmarks(content)

    // Apply filters
    if (search) {
      bookmarks = bookmarks.filter(
        (b) =>
          b.title.toLowerCase().includes(search) ||
          b.summary.toLowerCase().includes(search) ||
          b.url.toLowerCase().includes(search) ||
          b.tags.some((t) => t.toLowerCase().includes(search))
      )
    }
    if (type) {
      bookmarks = bookmarks.filter((b) => b.type === type)
    }
    if (tag) {
      const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`
      bookmarks = bookmarks.filter((b) => b.tags.includes(normalizedTag))
    }
    if (date) {
      bookmarks = bookmarks.filter((b) => b.date === date)
    }

    // Collect all types and tags for filters
    const allBookmarks = parseBookmarks(content)
    const types = [...new Set(allBookmarks.map((b) => b.type))]
    const allTags = [...new Set(allBookmarks.flatMap((b) => b.tags))].sort()

    return NextResponse.json({
      bookmarks: bookmarks.reverse(), // newest first
      total: bookmarks.length,
      types,
      allTags,
    })
  } catch (error) {
    logger.error({ err: error }, 'Bookmarks API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    if (!BOOKMARKS_PATH) {
      return NextResponse.json({ error: 'Bookmarks path not configured' }, { status: 500 })
    }

    const body = await request.json()
    const { url, title, type, summary, tags } = body

    if (!url || !title) {
      return NextResponse.json({ error: 'URL and title are required' }, { status: 400 })
    }

    let content: string
    try {
      content = await readFile(BOOKMARKS_PATH, 'utf-8')
    } catch {
      content = ''
    }

    const bookmarks = parseBookmarks(content)

    // Format current time in ET
    const now = new Date()
    const etTime = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    const etDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    const tagList = (tags || []).map((t: string) =>
      t.startsWith('#') ? t : `#${t.toLowerCase().replace(/\s+/g, '-')}`
    )

    bookmarks.push({
      id: bookmarks.length + 1,
      date: etDate,
      time: `${etTime} ET`,
      type: type || 'link',
      url,
      title,
      summary: summary || '',
      tags: tagList,
    })

    await writeFile(BOOKMARKS_PATH, bookmarksToMarkdown(bookmarks), 'utf-8')

    return NextResponse.json({ success: true, message: 'Bookmark added' })
  } catch (error) {
    logger.error({ err: error }, 'Bookmarks POST error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
