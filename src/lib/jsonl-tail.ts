import { existsSync, openSync, readSync, closeSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_TAIL_BYTES = 768 * 1024
export const TRANSCRIPT_TAIL_BYTES = 8 * 1024 * 1024

export const SESSION_ID_RE = /^[a-zA-Z0-9._:-]{6,128}$/

function isSessionFile(name: string, sessionId: string): boolean {
  if (!name.endsWith('.jsonl')) return false
  if (name === `${sessionId}.jsonl`) return true
  const stem = name.slice(0, -6)
  return stem === sessionId || stem.endsWith(`-${sessionId}`)
}

export function findNamedJsonl(root: string, sessionId: string): string | null {
  if (!root || !SESSION_ID_RE.test(sessionId) || !existsSync(root)) return null
  const wanted = `${sessionId}.jsonl`
  const stack = [root]
  let visited = 0
  while (stack.length > 0 && visited < 4000) {
    const dir = stack.pop()
    if (!dir) continue
    visited += 1
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && isSessionFile(entry.name, sessionId)) {
        return join(dir, entry.name)
      }
      if (entry.isDirectory() && entry.name !== sessionId && !entry.name.startsWith('.')) {
        stack.push(join(dir, entry.name))
      }
    }
  }
  return null
}

export function readJsonlTailLines(filePath: string, maxBytes = DEFAULT_TAIL_BYTES): string[] {
  let fd: number
  try {
    fd = openSync(filePath, 'r')
  } catch {
    return []
  }
  try {
    const size = statSync(filePath).size
    const length = Math.min(Math.max(0, size), Math.max(4096, maxBytes))
    const start = Math.max(0, size - length)
    const buf = Buffer.alloc(length)
    const bytes = readSync(fd, buf, 0, length, start)
    const raw = buf.subarray(0, bytes).toString('utf8')
    const lines = raw.split('\n')
    if (start > 0 && lines.length > 0) lines.shift()
    return lines.map((line) => line.trim()).filter(Boolean)
  } finally {
    closeSync(fd)
  }
}
