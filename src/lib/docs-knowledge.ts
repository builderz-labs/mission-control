import { open, readdir, readFile, stat, lstat, realpath } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join, sep } from 'path'
import { resolveWithin } from '@/lib/paths'
import { config } from '@/lib/config'

const DOC_ROOT_CANDIDATES = ['docs', 'knowledge-base', 'knowledge', 'memory']

export interface DocsTreeNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: DocsTreeNode[]
}

function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function isWithinBase(base: string, candidate: string): boolean {
  if (candidate === base) return true
  return candidate.startsWith(base + sep)
}

async function resolveSafePath(baseDir: string, relativePath: string): Promise<string> {
  const baseReal = await realpath(baseDir)
  const fullPath = resolveWithin(baseDir, relativePath)

  let parentReal: string
  try {
    parentReal = await realpath(dirname(fullPath))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error('Parent directory not found')
    throw err
  }

  if (!isWithinBase(baseReal, parentReal)) {
    throw new Error('Path escapes base directory (symlink)')
  }

  try {
    const st = await lstat(fullPath)
    if (st.isSymbolicLink()) throw new Error('Symbolic links are not allowed')
    const fileReal = await realpath(fullPath)
    if (!isWithinBase(baseReal, fileReal)) {
      throw new Error('Path escapes base directory (symlink)')
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }

  return fullPath
}

function allowedRoots(baseDir: string): string[] {
  const candidateRoots = DOC_ROOT_CANDIDATES.filter((root) => existsSync(join(baseDir, root)))
  if (candidateRoots.length > 0) return candidateRoots

  const fromConfig = (config.memoryAllowedPrefixes || [])
    .map((prefix) => normalizeRelativePath(prefix).replace(/\/$/, ''))
    .filter((prefix) => prefix.length > 0)
    .filter((prefix) => existsSync(join(baseDir, prefix)))

  return fromConfig
}

export function listDocsRoots(): string[] {
  const baseDir = config.memoryDir
  if (!baseDir || !existsSync(baseDir)) return []
  return allowedRoots(baseDir)
}

export function isDocsPathAllowed(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) return false

  const baseDir = config.memoryDir
  if (!baseDir || !existsSync(baseDir)) return false

  const roots = allowedRoots(baseDir)
  if (roots.length === 0) return false

  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}

async function buildTreeFrom(dirPath: string, relativeBase: string): Promise<DocsTreeNode[]> {
  const items = await readdir(dirPath, { withFileTypes: true })
  const nodes: DocsTreeNode[] = []

  for (const item of items) {
    if (item.isSymbolicLink()) continue
    const fullPath = join(dirPath, item.name)
    const relativePath = normalizeRelativePath(join(relativeBase, item.name))

    try {
      const info = await stat(fullPath)
      if (item.isDirectory()) {
        const children = await buildTreeFrom(fullPath, relativePath)
        nodes.push({
          path: relativePath,
          name: item.name,
          type: 'directory',
          modified: info.mtime.getTime(),
          children,
        })
      } else if (item.isFile()) {
        nodes.push({
          path: relativePath,
          name: item.name,
          type: 'file',
          size: info.size,
          modified: info.mtime.getTime(),
        })
      }
    } catch {
      // Ignore unreadable files
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function getDocsTree(): Promise<DocsTreeNode[]> {
  const baseDir = config.memoryDir
  if (!baseDir || !existsSync(baseDir)) return []

  const roots = allowedRoots(baseDir)
  const tree: DocsTreeNode[] = []

  for (const root of roots) {
    const rootPath = join(baseDir, root)
    try {
      const info = await stat(rootPath)
      if (!info.isDirectory()) continue
      tree.push({
        path: root,
        name: root,
        type: 'directory',
        modified: info.mtime.getTime(),
        children: await buildTreeFrom(rootPath, root),
      })
    } catch {
      // Ignore unreadable roots
    }
  }

  return tree
}

export async function readDocsContent(relativePath: string): Promise<{ content: string; size: number; modified: number; path: string }> {
  if (!isDocsPathAllowed(relativePath)) {
    throw new Error('Path not allowed')
  }

  const baseDir = config.memoryDir
  if (!baseDir || !existsSync(baseDir)) {
    throw new Error('Docs directory not configured')
  }

  const safePath = await resolveSafePath(baseDir, relativePath)
  const content = await readFile(safePath, 'utf-8')
  const info = await stat(safePath)

  return {
    content,
    size: info.size,
    modified: info.mtime.getTime(),
    path: normalizeRelativePath(relativePath),
  }
}

function isSearchable(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.txt')
}

export async function searchDocs(query: string, limit = 100): Promise<Array<{ path: string; name: string; matches: number }>> {
  const baseDir = config.memoryDir
  if (!baseDir || !existsSync(baseDir)) return []

  const roots = allowedRoots(baseDir)
  if (roots.length === 0) return []

  const q = query.trim().toLowerCase()
  if (!q) return []

  const results: Array<{ path: string; name: string; matches: number }> = []

  const searchFile = async (fullPath: string, relativePath: string) => {
    let handle
    try {
      handle = await open(fullPath, 'r')
      const info = await handle.stat()
      if (info.size > 1_000_000) return
      const content = (await handle.readFile('utf-8')).toLowerCase()
      let count = 0
      let idx = content.indexOf(q)
      while (idx !== -1) {
        count += 1
        idx = content.indexOf(q, idx + q.length)
      }
      if (count > 0) {
        results.push({
          path: normalizeRelativePath(relativePath),
          name: relativePath.split('/').pop() || relativePath,
          matches: count,
        })
      }
    } catch {
      // Ignore unreadable files
    } finally {
      await handle?.close()
    }
  }

  const searchDir = async (fullDir: string, relativeDir: string) => {
    const items = await readdir(fullDir, { withFileTypes: true })
    for (const item of items) {
      if (item.isSymbolicLink()) continue
      const itemFull = join(fullDir, item.name)
      const itemRel = normalizeRelativePath(join(relativeDir, item.name))
      if (item.isDirectory()) {
        await searchDir(itemFull, itemRel)
      } else if (item.isFile() && isSearchable(item.name.toLowerCase())) {
        await searchFile(itemFull, itemRel)
      }
    }
  }

  for (const root of roots) {
    const rootPath = join(baseDir, root)
    try {
      await searchDir(rootPath, root)
    } catch {
      // Ignore unreadable roots
    }
  }

  return results.sort((a, b) => b.matches - a.matches).slice(0, Math.max(1, Math.min(limit, 200)))
}
