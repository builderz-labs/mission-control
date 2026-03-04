/**
 * Briefing Room API — Browse agent research outputs
 *
 * GET /api/lionroot/briefing-room?action=agents        → List agents with output counts
 * GET /api/lionroot/briefing-room?action=outputs&agent=X → List output files for agent
 * GET /api/lionroot/briefing-room?action=read&agent=X&file=Y → Read markdown content
 * GET /api/lionroot/briefing-room?action=search&query=Q → Search across all outputs
 * GET /api/lionroot/briefing-room?action=reads          → Get read/unread status
 * POST /api/lionroot/briefing-room { action: "mark-read", agent, file } → Mark as read
 */

import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join, sep } from 'path'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Resolve the agent workspaces base directory.
 *
 * In production the MC_WORKSPACE_REMAP env var tells us where the remapped
 * workspaces live inside the container (the "to" side of the remap).
 * Fallback: try /data/clawd-agents, then OPENCLAW_HOME/agents.
 */
function getAgentsBaseDir(): string | null {
  const remap = process.env.MC_WORKSPACE_REMAP
  if (remap) {
    const eqIdx = remap.indexOf('=')
    if (eqIdx > 0) {
      const to = remap.slice(eqIdx + 1)
      if (to && existsSync(to)) return to
    }
  }
  if (existsSync('/data/clawd-agents')) return '/data/clawd-agents'
  const home = process.env.OPENCLAW_HOME
  if (home) {
    const agentsDir = join(home, 'agents')
    if (existsSync(agentsDir)) return agentsDir
  }
  return null
}

/** Validate that a path component doesn't escape (no ..) */
function safeName(name: string): string {
  if (!name || name.includes('..') || name.includes('\\')) {
    throw new Error('Invalid name')
  }
  return name
}

/** Validate a relative file path (allows / for subdir structure, blocks ..) */
function safeRelPath(name: string): string {
  if (!name || name.includes('..') || name.includes('\\') || name.startsWith('/')) {
    throw new Error('Invalid path')
  }
  // Validate each segment
  for (const seg of name.split('/')) {
    if (!seg || seg === '.' || seg === '..') throw new Error('Invalid path')
  }
  return name
}

interface OutputFile {
  name: string
  size: number
  modified: number
}

async function listOutputFiles(agentDir: string): Promise<OutputFile[]> {
  const outputsDir = join(agentDir, 'outputs')
  if (!existsSync(outputsDir)) return []

  const files: OutputFile[] = []

  async function scanDir(dir: string, prefix: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        // Recurse into date folders and other subdirs (max 2 levels)
        if (prefix.split('/').length < 2) {
          await scanDir(fullPath, relativeName)
        }
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
        try {
          const st = await stat(fullPath)
          files.push({ name: relativeName, size: st.size, modified: st.mtimeMs })
        } catch { /* skip unreadable */ }
      }
    }
  }

  await scanDir(outputsDir, '')

  // Newest first
  return files.sort((a, b) => b.modified - a.modified)
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  const baseDir = getAgentsBaseDir()
  if (!baseDir) {
    return NextResponse.json({ error: 'Agent workspaces not configured' }, { status: 500 })
  }

  try {
    // ── List agents with output counts ──
    if (action === 'agents') {
      const entries = await readdir(baseDir, { withFileTypes: true })
      const agents: Array<{ id: string; outputCount: number; totalSize: number; latestOutput?: number }> = []

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        const agentDir = join(baseDir, entry.name)
        const files = await listOutputFiles(agentDir)
        if (files.length === 0) continue
        agents.push({
          id: entry.name,
          outputCount: files.length,
          totalSize: files.reduce((s, f) => s + f.size, 0),
          latestOutput: files[0]?.modified,
        })
      }

      // Sort by latest output (most recent first)
      agents.sort((a, b) => (b.latestOutput || 0) - (a.latestOutput || 0))

      // Get read counts from DB
      const db = getDatabase()
      const readCounts = db.prepare(
        'SELECT agent, COUNT(*) as count FROM briefing_room_reads GROUP BY agent'
      ).all() as Array<{ agent: string; count: number }>
      const readMap = Object.fromEntries(readCounts.map(r => [r.agent, r.count]))

      return NextResponse.json({
        agents: agents.map(a => ({
          ...a,
          readCount: readMap[a.id] || 0,
          unreadCount: a.outputCount - (readMap[a.id] || 0),
        })),
      })
    }

    // ── List outputs for an agent ──
    if (action === 'outputs') {
      const agentId = safeName(searchParams.get('agent') || '')
      const agentDir = join(baseDir, agentId)
      if (!existsSync(agentDir)) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
      }

      const files = await listOutputFiles(agentDir)

      // Get read status from DB
      const db = getDatabase()
      const reads = db.prepare(
        'SELECT filepath, read_at, notes FROM briefing_room_reads WHERE agent = ?'
      ).all(agentId) as Array<{ filepath: string; read_at: number; notes: string | null }>
      const readMap = Object.fromEntries(reads.map(r => [r.filepath, { readAt: r.read_at, notes: r.notes }]))

      return NextResponse.json({
        agent: agentId,
        files: files.map(f => ({
          ...f,
          read: !!readMap[f.name],
          readAt: readMap[f.name]?.readAt || null,
        })),
      })
    }

    // ── Read a specific file ──
    if (action === 'read') {
      const agentId = safeName(searchParams.get('agent') || '')
      const fileName = safeRelPath(searchParams.get('file') || '')
      const filePath = join(baseDir, agentId, 'outputs', fileName)

      if (!existsSync(filePath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const content = await readFile(filePath, 'utf-8')
      const st = await stat(filePath)

      return NextResponse.json({
        agent: agentId,
        file: fileName,
        content,
        size: st.size,
        modified: st.mtimeMs,
      })
    }

    // ── Search across all outputs ──
    if (action === 'search') {
      const query = (searchParams.get('query') || '').toLowerCase().trim()
      if (!query) {
        return NextResponse.json({ error: 'Query required' }, { status: 400 })
      }

      const results: Array<{ agent: string; file: string; matches: number; modified: number }> = []
      const agentEntries = await readdir(baseDir, { withFileTypes: true })

      for (const agentEntry of agentEntries) {
        if (!agentEntry.isDirectory() || agentEntry.name.startsWith('.') || agentEntry.name.startsWith('_')) continue
        const outputsDir = join(baseDir, agentEntry.name, 'outputs')
        if (!existsSync(outputsDir)) continue

        // Recursively search outputs (handles date-folder structure)
        async function searchOutputs(dir: string, prefix: string) {
          const items = await readdir(dir, { withFileTypes: true })
          for (const item of items) {
            if (item.name.startsWith('.')) continue
            const fullPath = join(dir, item.name)
            const relName = prefix ? `${prefix}/${item.name}` : item.name

            if (item.isDirectory() && prefix.split('/').length < 2) {
              await searchOutputs(fullPath, relName)
            } else if (item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.txt'))) {
              try {
                const st = await stat(fullPath)
                if (st.size > 500_000) continue

                let matches = relName.toLowerCase().includes(query) ? 1 : 0
                const content = await readFile(fullPath, 'utf-8')
                const lower = content.toLowerCase()
                let idx = lower.indexOf(query)
                while (idx !== -1) {
                  matches++
                  idx = lower.indexOf(query, idx + query.length)
                }
                if (matches > 0) {
                  results.push({ agent: agentEntry.name, file: relName, matches, modified: st.mtimeMs })
                }
              } catch { /* skip */ }
            }
          }
        }
        await searchOutputs(outputsDir, '')
      }

      results.sort((a, b) => b.matches - a.matches)
      return NextResponse.json({ query, results: results.slice(0, 50) })
    }

    // ── Get all read records ──
    if (action === 'reads') {
      const db = getDatabase()
      const reads = db.prepare(
        'SELECT agent, filepath, read_at, notes FROM briefing_room_reads ORDER BY read_at DESC'
      ).all() as Array<{ agent: string; filepath: string; read_at: number; notes: string | null }>
      return NextResponse.json({ reads })
    }

    return NextResponse.json({ error: 'Invalid action. Use: agents, outputs, read, search, reads' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Briefing Room API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { action, agent, file, notes } = body

    if (action === 'mark-read') {
      if (!agent || !file) {
        return NextResponse.json({ error: 'agent and file required' }, { status: 400 })
      }
      safeName(agent)
      safeRelPath(file)

      const db = getDatabase()
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO briefing_room_reads (agent, filepath, read_at, notes)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agent, filepath) DO UPDATE SET read_at = excluded.read_at, notes = excluded.notes
      `).run(agent, file, now, notes || null)

      return NextResponse.json({ success: true })
    }

    if (action === 'mark-unread') {
      if (!agent || !file) {
        return NextResponse.json({ error: 'agent and file required' }, { status: 400 })
      }
      safeName(agent)
      safeRelPath(file)

      const db = getDatabase()
      db.prepare('DELETE FROM briefing_room_reads WHERE agent = ? AND filepath = ?').run(agent, file)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action. Use: mark-read, mark-unread' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Briefing Room POST error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
