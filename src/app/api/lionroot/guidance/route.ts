/**
 * Guidance API — Commander's Intent 4-level guidance system
 *
 * GET /api/lionroot/guidance?mode=inventory            → Full inventory with coverage stats
 * GET /api/lionroot/guidance?level=X&slug=Y            → Read single guidance file
 * PUT /api/lionroot/guidance { level, slug, content }  → Update existing file
 * POST /api/lionroot/guidance { level, slug, content } → Create new file
 *
 * 4 levels:
 *   1. Standard Instructions (STANDARD-INSTRUCTIONS.md)
 *   2. Agent-specific (agents/{slug}.md)
 *   3. Channel-specific (channels/{slug}.md)
 *   4. Topic-specific (channels/{channel}/{topic}.md)
 */

import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/* ── Path Resolution ── */

function guidanceRoot(): string | null {
  if (process.env.GUIDANCE_ROOT && existsSync(process.env.GUIDANCE_ROOT)) {
    return process.env.GUIDANCE_ROOT
  }
  return null
}

function resolveFilePath(root: string, level: string, slug: string): string | null {
  let filePath: string
  switch (level) {
    case 'standard':
      filePath = join(root, 'STANDARD-INSTRUCTIONS.md')
      break
    case 'agent':
      filePath = join(root, 'agents', `${slug}.md`)
      break
    case 'channel':
      filePath = join(root, 'channels', `${slug}.md`)
      break
    case 'topic': {
      const parts = slug.split('/')
      if (parts.length !== 2) return null
      filePath = join(root, 'channels', parts[0], `${parts[1]}.md`)
      break
    }
    default:
      return null
  }

  // Path traversal guard — resolved path must stay within GUIDANCE_ROOT
  const resolved = resolve(filePath)
  const rootResolved = resolve(root)
  if (!resolved.startsWith(rootResolved + '/') && resolved !== rootResolved) {
    return null
  }
  return resolved
}

/* ── Inventory Builder ── */

interface InventoryItem {
  slug: string
  label: string
  path: string
  exists: boolean
  content?: string
}

interface GuidanceInventory {
  standard: InventoryItem
  agents: InventoryItem[]
  channels: InventoryItem[]
  topics: InventoryItem[]
  coverage: {
    agents: { total: number; covered: number }
    channels: { total: number; covered: number }
  }
}

/**
 * Well-known agent IDs with display labels + emoji.
 *
 * TODO: Sync with @openclaw/contracts AGENTS when the package is available
 * in the MC workspace. For now, update manually when agents change.
 * @see command-post/dashboard/app/api/guidance/route.ts (CP's version uses contracts)
 */
const KNOWN_AGENTS: Array<{ id: string; emoji: string; name: string; domain: string }> = [
  { id: 'archie', emoji: '🏗️', name: 'Archie', domain: 'Infrastructure' },
  { id: 'artie', emoji: '🎨', name: 'Artie', domain: 'Creative & Art' },
  { id: 'clawdy', emoji: '🦞', name: 'Clawdy', domain: 'Gateway & CLI' },
  { id: 'cody', emoji: '💻', name: 'Cody', domain: 'Engineering' },
  { id: 'exdi', emoji: '📊', name: 'Exdi', domain: 'Experience Design' },
  { id: 'finn', emoji: '💰', name: 'Finn', domain: 'Finance' },
  { id: 'grove', emoji: '🌿', name: 'Grove', domain: 'Growth & Marketing' },
  { id: 'leo', emoji: '🦁', name: 'Leo', domain: 'Strategy & Research' },
  { id: 'liev', emoji: '🍳', name: 'Liev', domain: 'Life & Family' },
  { id: 'mako', emoji: '🔧', name: 'Mako', domain: 'Maker & Prototyping' },
  { id: 'nesta', emoji: '🏠', name: 'Nesta', domain: 'Homestead & Physical' },
  { id: 'schoolie', emoji: '📚', name: 'Schoolie', domain: 'Education' },
]

/** Known channel slugs (matching Zulip stream names) */
const KNOWN_CHANNELS: Array<{ slug: string; label: string }> = [
  { slug: 'clawdy-loop', label: 'Clawdy Loop' },
  { slug: 'coding-loop', label: 'Coding Loop' },
  { slug: 'creative-loop', label: 'Creative Loop' },
  { slug: 'experience-design-loop', label: 'Experience Design Loop' },
  { slug: 'family', label: 'Family' },
  { slug: 'finn-loop', label: 'Finn Loop' },
  { slug: 'growth-marketing-loop', label: 'Growth Marketing Loop' },
  { slug: 'infrastructure-loop', label: 'Infrastructure Loop' },
  { slug: 'life-loop', label: 'Life Loop' },
  { slug: 'maker-loop', label: 'Maker Loop' },
  { slug: 'nesta-loop', label: 'Nesta Loop' },
  { slug: 'strategy-loop', label: 'Strategy Loop' },
]

async function buildInventory(root: string, includeContent: boolean): Promise<GuidanceInventory> {
  // Level 1 — Standard Instructions
  const standardPath = join(root, 'STANDARD-INSTRUCTIONS.md')
  const standardExists = existsSync(standardPath)
  const standard: InventoryItem = {
    slug: 'standard',
    label: "Standard Instructions (Commander's Intent)",
    path: 'STANDARD-INSTRUCTIONS.md',
    exists: standardExists,
    ...(includeContent && standardExists
      ? { content: await readFile(standardPath, 'utf-8') }
      : {}),
  }

  // Level 2 — Agents
  const agents: InventoryItem[] = await Promise.all(
    KNOWN_AGENTS.map(async (a) => {
      const filePath = join(root, 'agents', `${a.id}.md`)
      const exists = existsSync(filePath)
      return {
        slug: a.id,
        label: `${a.emoji} ${a.name} — ${a.domain}`,
        path: `agents/${a.id}.md`,
        exists,
        ...(includeContent && exists
          ? { content: await readFile(filePath, 'utf-8') }
          : {}),
      }
    }),
  )

  // Level 3 — Channels
  const channels: InventoryItem[] = await Promise.all(
    KNOWN_CHANNELS.map(async (c) => {
      const filePath = join(root, 'channels', `${c.slug}.md`)
      const exists = existsSync(filePath)
      return {
        slug: c.slug,
        label: c.label,
        path: `channels/${c.slug}.md`,
        exists,
        ...(includeContent && exists
          ? { content: await readFile(filePath, 'utf-8') }
          : {}),
      }
    }),
  )

  // Level 4 — Discover topic files from channel subdirectories
  const topics: InventoryItem[] = []
  const channelsDir = join(root, 'channels')
  if (existsSync(channelsDir)) {
    try {
      const entries = await readdir(channelsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const topicDir = join(channelsDir, entry.name)
          const topicFiles = await readdir(topicDir)
          for (const file of topicFiles) {
            if (file.endsWith('.md')) {
              const topicSlug = basename(file, '.md')
              const filePath = join(topicDir, file)
              topics.push({
                slug: `${entry.name}/${topicSlug}`,
                label: `${entry.name} › ${topicSlug}`,
                path: `channels/${entry.name}/${file}`,
                exists: true,
                ...(includeContent
                  ? { content: await readFile(filePath, 'utf-8') }
                  : {}),
              })
            }
          }
        }
      }
    } catch {
      // channels dir may be empty or inaccessible
    }
  }

  return {
    standard,
    agents,
    channels,
    topics,
    coverage: {
      agents: {
        total: agents.length,
        covered: agents.filter((a) => a.exists).length,
      },
      channels: {
        total: channels.length,
        covered: channels.filter((c) => c.exists).length,
      },
    },
  }
}

/* ── GET ── */

export async function GET(req: NextRequest) {
  const authError = requireRole(req, 'viewer')
  if (authError) return authError

  const limited = readLimiter(req)
  if (limited) return limited

  const root = guidanceRoot()
  if (!root) {
    return NextResponse.json(
      { error: 'guidance_not_configured', message: 'GUIDANCE_ROOT is not set or directory does not exist' },
      { status: 503 },
    )
  }

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode')
  const includeContent = url.searchParams.get('content') === 'true'

  try {
    // Inventory mode
    if (mode === 'inventory') {
      const inventory = await buildInventory(root, includeContent)
      return NextResponse.json(inventory)
    }

    // Single-file read
    const level = url.searchParams.get('level')
    const slug = url.searchParams.get('slug')
    if (level && slug) {
      const filePath = resolveFilePath(root, level, slug)
      if (!filePath) {
        return NextResponse.json(
          { error: 'invalid_path', message: 'Could not resolve file path' },
          { status: 400 },
        )
      }
      if (!existsSync(filePath)) {
        return NextResponse.json(
          { error: 'not_found', message: 'Guidance file does not exist' },
          { status: 404 },
        )
      }
      const content = await readFile(filePath, 'utf-8')
      return NextResponse.json({ level, slug, path: filePath, content })
    }

    // Default: return inventory summary (no content)
    const inventory = await buildInventory(root, false)
    return NextResponse.json(inventory)
  } catch (err) {
    logger.error('guidance GET error', err)
    return NextResponse.json(
      { error: 'guidance_error', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

/* ── PUT (update existing) ── */

export async function PUT(req: NextRequest) {
  const authError = requireRole(req, 'operator')
  if (authError) return authError

  const limited = mutationLimiter(req)
  if (limited) return limited

  const root = guidanceRoot()
  if (!root) {
    return NextResponse.json(
      { error: 'guidance_not_configured', message: 'GUIDANCE_ROOT is not set' },
      { status: 503 },
    )
  }

  try {
    let body: { level?: string; slug?: string; content?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Request body must be valid JSON' },
        { status: 400 },
      )
    }
    const { level, slug, content } = body

    if (!level || !content) {
      return NextResponse.json(
        { error: 'missing_field', message: 'level and content are required' },
        { status: 400 },
      )
    }

    if (level !== 'standard' && !slug) {
      return NextResponse.json(
        { error: 'missing_field', message: 'slug is required for non-standard levels' },
        { status: 400 },
      )
    }

    const filePath = resolveFilePath(root, level, slug || 'standard')
    if (!filePath) {
      return NextResponse.json(
        { error: 'invalid_path', message: 'Could not resolve file path' },
        { status: 400 },
      )
    }

    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: 'not_found', message: 'Guidance file does not exist. Use POST to create.' },
        { status: 404 },
      )
    }

    await writeFile(filePath, content, 'utf-8')
    logger.info(`guidance updated: ${level}/${slug || 'standard'}`)
    return NextResponse.json({ ok: true, level, slug, path: filePath })
  } catch (err) {
    logger.error('guidance PUT error', err)
    return NextResponse.json(
      { error: 'guidance_update_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

/* ── POST (create new) ── */

export async function POST(req: NextRequest) {
  const authError = requireRole(req, 'operator')
  if (authError) return authError

  const limited = mutationLimiter(req)
  if (limited) return limited

  const root = guidanceRoot()
  if (!root) {
    return NextResponse.json(
      { error: 'guidance_not_configured', message: 'GUIDANCE_ROOT is not set' },
      { status: 503 },
    )
  }

  try {
    let body: { level?: string; slug?: string; content?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Request body must be valid JSON' },
        { status: 400 },
      )
    }
    const { level, slug, content } = body

    if (!level || !slug || !content) {
      return NextResponse.json(
        { error: 'missing_field', message: 'level, slug, and content are required' },
        { status: 400 },
      )
    }

    const filePath = resolveFilePath(root, level, slug)
    if (!filePath) {
      return NextResponse.json(
        { error: 'invalid_path', message: 'Could not resolve file path' },
        { status: 400 },
      )
    }

    if (existsSync(filePath)) {
      return NextResponse.json(
        { error: 'already_exists', message: 'Guidance file already exists. Use PUT to update.' },
        { status: 409 },
      )
    }

    // Ensure parent directory exists
    const dir = dirname(filePath)
    await mkdir(dir, { recursive: true })

    await writeFile(filePath, content, 'utf-8')
    logger.info(`guidance created: ${level}/${slug}`)
    return NextResponse.json({ ok: true, level, slug, path: filePath })
  } catch (err) {
    logger.error('guidance POST error', err)
    return NextResponse.json(
      { error: 'guidance_create_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
