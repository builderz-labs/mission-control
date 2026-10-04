import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const WRITE_LOCK_NAME = '.ai-ops-content.lock'
const LOCKED = 'Shufuro Content OS is locked by another writer.'

export function acquireShufuroWriteLock(root: string, owner = 'ai-ops-hub'): () => void {
  const lockPath = join(root, WRITE_LOCK_NAME)
  const token = randomUUID()
  const payload = JSON.stringify({ owner, pid: process.pid, token, created_at: new Date().toISOString() })
  const tryAcquire = () => {
    const fd = openSync(lockPath, 'wx')
    try {
      writeFileSync(fd, payload, 'utf8')
    } catch (error) {
      try { unlinkSync(lockPath) } catch {}
      throw error
    } finally {
      closeSync(fd)
    }
  }

  try {
    tryAcquire()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(LOCKED)
    throw error
  }

  let released = false
  return () => {
    if (released) return
    released = true
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: string }
      if (current.token === token) unlinkSync(lockPath)
    } catch {}
  }
}

export interface ShufuroQueueRow {
  order: string
  type: string
  series: string
  episode: string
  title: string
  layer: string
  timing: string
  format: string
  status: string
}

export function shufuroContentRoot(): string {
  return resolve(
    process.env.AI_OPS_SHUFURO_CONTENT_ROOT
      || 'C:\\Dev\\obsidian-shufuro-sync-1003\\10 Projects\\Shufuro\\Marketing Content OS',
  )
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

export function parseQueue(markdown: string): ShufuroQueueRow[] {
  const rows: ShufuroQueueRow[] = []
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^\|\s*\d{3}\s*\|/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 9) continue
    const [order, type, series, episode, title, layer, timing, format, status] = cells
    rows.push({ order, type, series, episode, title, layer, timing, format, status: status.toUpperCase() })
  }
  return rows
}

export function findEpisodePacket(root: string, episode: string): string | null {
  const locations = [join(root, 'Episodes'), join(root, 'Tips')]
  for (const base of locations) {
    if (!existsSync(base)) continue
    const stack = [base]
    while (stack.length > 0) {
      const dir = stack.pop()!
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile() && entry.name.startsWith(episode + '_') && entry.name.endsWith('.md')) return full
      }
    }
  }
  return null
}

export function frontmatterValue(markdown: string, key: string): string | null {
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '---') break
    const prefix = key + ':'
    if (line.startsWith(prefix)) {
      const value = line.slice(prefix.length).trim()
      return value || null
    }
  }
  return null
}

export function contentRevision(parts: Array<string | Buffer>): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

export function listPostRecords(root: string): string[] {
  const dir = join(root, 'Posts')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^P\d+\.md$/i.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export function parseBacktickPaths(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\x60([A-Za-z]:\\[^\x60]+)\x60/g)).map((match) => match[1])
}

export function safeLabel(path: string): string {
  return basename(path)
}
