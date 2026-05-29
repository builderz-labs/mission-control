import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

interface AgentFileInfo {
  path: string
  chunks: number
  textSize: number
}

interface AgentGraphData {
  name: string
  dbSize: number
  totalChunks: number
  totalFiles: number
  files: AgentFileInfo[]
}

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes')
const MAX_SESSION_FILES_PER_PROFILE = 80

function countApproxChunks(filePath: string): { chunks: number; textSize: number } {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return { chunks: 0, textSize: 0 }

    // Keep large files cheap: estimate chunks by bytes instead of reading huge JSONL files.
    if (stat.size > 512 * 1024) {
      return { chunks: Math.max(1, Math.ceil(stat.size / 4096)), textSize: stat.size }
    }

    const text = readFileSync(filePath, 'utf8')
    const trimmed = text.trim()
    if (!trimmed) return { chunks: 0, textSize: stat.size }

    // JSONL session files: each message-ish row is a useful node chunk.
    if (filePath.endsWith('.jsonl')) {
      const lines = trimmed.split(/\r?\n/).filter(Boolean).length
      return { chunks: Math.max(1, lines), textSize: text.length }
    }

    // Markdown profile memory: split by memory separators / paragraphs.
    const sections = trimmed
      .split(/\n(?:§|---|#{1,6}\s+|\n)\n/g)
      .map(s => s.trim())
      .filter(Boolean)
    return { chunks: Math.max(1, sections.length), textSize: text.length }
  } catch {
    return { chunks: 0, textSize: 0 }
  }
}

function addFile(files: AgentFileInfo[], root: string, absolutePath: string) {
  if (!existsSync(absolutePath)) return
  const stat = statSync(absolutePath)
  if (!stat.isFile()) return
  const rel = path.relative(root, absolutePath) || path.basename(absolutePath)
  const { chunks, textSize } = countApproxChunks(absolutePath)
  files.push({ path: rel, chunks, textSize })
}

function collectSessionFiles(files: AgentFileInfo[], root: string, sessionsDir: string) {
  if (!existsSync(sessionsDir)) return
  const entries = readdirSync(sessionsDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(sessionsDir, f))
    .filter(f => {
      try { return statSync(f).isFile() } catch { return false }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, MAX_SESSION_FILES_PER_PROFILE)

  for (const filePath of entries) addFile(files, root, filePath)
}

function getHermesProfileData(name: string, root: string): AgentGraphData | null {
  if (!existsSync(root)) return null

  const files: AgentFileInfo[] = []
  addFile(files, root, path.join(root, 'memories', 'MEMORY.md'))
  addFile(files, root, path.join(root, 'memories', 'USER.md'))
  collectSessionFiles(files, root, path.join(root, 'sessions'))

  // state.db is the Hermes session/search database. We show it as an index node,
  // but do not parse internals here; user-facing graph should not be OpenClaw-specific.
  addFile(files, root, path.join(root, 'state.db'))

  if (files.length === 0) return null

  const dbSize = files.reduce((sum, file) => sum + file.textSize, 0)
  const totalChunks = files.reduce((sum, file) => sum + file.chunks, 0)

  return {
    name,
    dbSize,
    totalChunks,
    totalFiles: files.length,
    files: files.sort((a, b) => b.chunks - a.chunks),
  }
}

function collectHermesMemoryGraph(agentFilter: string): AgentGraphData[] {
  const agents: AgentGraphData[] = []

  const defaultProfile = getHermesProfileData('Hermes default', HERMES_HOME)
  if (defaultProfile && (agentFilter === 'all' || agentFilter === defaultProfile.name)) {
    agents.push(defaultProfile)
  }

  const profilesRoot = path.join(HERMES_HOME, 'profiles')
  if (existsSync(profilesRoot)) {
    const profileDirs = readdirSync(profilesRoot)
      .map(name => ({ name, root: path.join(profilesRoot, name) }))
      .filter(item => {
        try { return statSync(item.root).isDirectory() } catch { return false }
      })

    for (const profile of profileDirs) {
      const displayName = `Hermes ${profile.name}`
      if (agentFilter !== 'all' && agentFilter !== displayName && agentFilter !== profile.name) continue
      const data = getHermesProfileData(displayName, profile.root)
      if (data) agents.push(data)
    }
  }

  agents.sort((a, b) => b.totalChunks - a.totalChunks)
  return agents
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  const agentFilter = request.nextUrl.searchParams.get('agent') || 'all'

  try {
    if (!existsSync(HERMES_HOME)) {
      return NextResponse.json(
        { error: 'Hermes home not available', agents: [], hermesHome: HERMES_HOME },
        { status: 404 }
      )
    }

    const agents = collectHermesMemoryGraph(agentFilter)
    return NextResponse.json({ agents, hermesHome: HERMES_HOME })
  } catch (err) {
    logger.error(`Failed to build Hermes memory graph data: ${err}`)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
