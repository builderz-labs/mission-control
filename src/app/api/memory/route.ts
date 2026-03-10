import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat, lstat, realpath, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname, sep } from 'path'
import { config } from '@/lib/config'
import { db_helpers } from '@/lib/db'
import { resolveWithin } from '@/lib/paths'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateSchema, extractWikiLinks } from '@/lib/memory-utils'

const MEMORY_PATH = config.memoryDir
const MEMORY_ALLOWED_PREFIXES = (config.memoryAllowedPrefixes || []).map((p) => p.replace(/\\/g, '/'))

// Ensure memory directory exists on startup
if (MEMORY_PATH && !existsSync(MEMORY_PATH)) {
  try { mkdirSync(MEMORY_PATH, { recursive: true }) } catch { /* ignore */ }
}

interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function isPathAllowed(relativePath: string): boolean {
  if (!MEMORY_ALLOWED_PREFIXES.length) return true
  const normalized = normalizeRelativePath(relativePath)
  return MEMORY_ALLOWED_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))
}

function isWithinBase(base: string, candidate: string): boolean {
  if (candidate === base) return true
  return candidate.startsWith(base + sep)
}

async function resolveSafeMemoryPath(baseDir: string, relativePath: string): Promise<string> {
  const baseReal = await realpath(baseDir)
  const fullPath = resolveWithin(baseDir, relativePath)

  // For non-existent targets, validate containment using the nearest existing ancestor.
  // This allows nested creates (mkdir -p) while still blocking symlink escapes.
  let current = dirname(fullPath)
  let parentReal = ''
  while (!parentReal) {
    try {
      parentReal = await realpath(current)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
      const next = dirname(current)
      if (next === current) {
        throw new Error('Parent directory not found')
      }
      current = next
    }
  }
  if (!isWithinBase(baseReal, parentReal)) {
    throw new Error('Path escapes base directory (symlink)')
  }

  // If the file exists, ensure it also resolves within base and is not a symlink.
  try {
    const st = await lstat(fullPath)
    if (st.isSymbolicLink()) {
      throw new Error('Symbolic links are not allowed')
    }
    const fileReal = await realpath(fullPath)
    if (!isWithinBase(baseReal, fileReal)) {
      throw new Error('Path escapes base directory (symlink)')
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw err
    }
  }

  return fullPath
}

async function buildFileTree(
  dirPath: string,
  relativePath: string = '',
  maxDepth: number = Number.POSITIVE_INFINITY,
): Promise<MemoryFile[]> {
  try {
    const items = await readdir(dirPath, { withFileTypes: true })
    const files: MemoryFile[] = []

    for (const item of items) {
      if (item.isSymbolicLink()) {
        continue
      }
      const itemPath = join(dirPath, item.name)
      const itemRelativePath = join(relativePath, item.name)
      
      try {
        const stats = await stat(itemPath)
        
        if (item.isDirectory()) {
          const children =
            maxDepth > 0
              ? await buildFileTree(itemPath, itemRelativePath, maxDepth - 1)
              : undefined
          files.push({
            path: itemRelativePath,
            name: item.name,
            type: 'directory',
            modified: stats.mtime.getTime(),
            children
          })
        } else if (item.isFile()) {
          files.push({
            path: itemRelativePath,
            name: item.name,
            type: 'file',
            size: stats.size,
            modified: stats.mtime.getTime()
          })
        }
      } catch (error) {
        logger.error({ err: error, path: itemPath }, 'Error reading file')
      }
    }

    return files.sort((a, b) => {
      // Directories first, then files, alphabetical within each type
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  } catch (error) {
    logger.error({ err: error, path: dirPath }, 'Error reading directory')
    return []
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    const action = searchParams.get('action')
    const depthParam = Number.parseInt(searchParams.get('depth') || '', 10)
    const maxDepth = Number.isFinite(depthParam) ? Math.max(0, Math.min(depthParam, 8)) : Number.POSITIVE_INFINITY

    if (action === 'tree') {
      // Return the file tree
      if (!MEMORY_PATH) {
        return NextResponse.json({ tree: [] })
      }
      if (path) {
        if (!isPathAllowed(path)) {
          return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
        }
        const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path)
        const stats = await stat(fullPath).catch(() => null)
        if (!stats?.isDirectory()) {
          return NextResponse.json({ error: 'Directory not found' }, { status: 404 })
        }
        const tree = await buildFileTree(fullPath, path, maxDepth)
        return NextResponse.json({ tree })
      }
      if (MEMORY_ALLOWED_PREFIXES.length) {
        const tree: MemoryFile[] = []
        for (const prefix of MEMORY_ALLOWED_PREFIXES) {
          const folder = prefix.replace(/\/$/, '')
          const fullPath = join(MEMORY_PATH, folder)
          if (!existsSync(fullPath)) continue
          try {
            const stats = await stat(fullPath)
            if (!stats.isDirectory()) continue
            tree.push({
              path: folder,
              name: folder,
              type: 'directory',
              modified: stats.mtime.getTime(),
              children: await buildFileTree(fullPath, folder, maxDepth),
            })
          } catch {
            // Skip unreadable roots
          }
        }
        return NextResponse.json({ tree })
      }
      const tree = await buildFileTree(MEMORY_PATH, '', maxDepth)
      return NextResponse.json({ tree })
    }

    if (action === 'content' && path) {
      // Return file content
      if (!isPathAllowed(path)) {
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
      }
      if (!MEMORY_PATH) {
        return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
      }
      const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path)
      
      try {
        const content = await readFile(fullPath, 'utf-8')
        const stats = await stat(fullPath)

        // Extract wiki-links and schema validation for .md files
        const isMarkdown = path.endsWith('.md')
        const wikiLinks = isMarkdown ? extractWikiLinks(content) : []
        const schemaResult = isMarkdown ? validateSchema(content) : null

        return NextResponse.json({
          content,
          size: stats.size,
          modified: stats.mtime.getTime(),
          path,
          wikiLinks,
          schema: schemaResult,
        })
      } catch (error) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }
    }

    if (action === 'search') {
      const query = searchParams.get('query')
      if (!query) {
        return NextResponse.json({ error: 'Query required' }, { status: 400 })
      }
      if (!MEMORY_PATH) {
        return NextResponse.json({ query, results: [] })
      }

      // Simple file search - in production you'd want a more sophisticated search
      const results: Array<{path: string, name: string, matches: number}> = []
      
      const searchInFile = async (filePath: string, relativePath: string) => {
        try {
          const st = await stat(filePath)
          // Avoid large-file scanning and memory blowups.
          if (st.size > 1_000_000) {
            return
          }
          const content = await readFile(filePath, 'utf-8')
          const haystack = content.toLowerCase()
          const needle = query.toLowerCase()
          if (!needle) return
          let matches = 0
          let idx = haystack.indexOf(needle)
          while (idx !== -1) {
            matches += 1
            idx = haystack.indexOf(needle, idx + needle.length)
          }
          
          if (matches > 0) {
            results.push({
              path: relativePath,
              name: relativePath.split('/').pop() || '',
              matches
            })
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }

      const searchDirectory = async (dirPath: string, relativePath: string = '') => {
        try {
          const items = await readdir(dirPath, { withFileTypes: true })
          
          for (const item of items) {
            if (item.isSymbolicLink()) {
              continue
            }
            const itemPath = join(dirPath, item.name)
            const itemRelativePath = join(relativePath, item.name)
            
            if (item.isDirectory()) {
              await searchDirectory(itemPath, itemRelativePath)
            } else if (item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.txt'))) {
              await searchInFile(itemPath, itemRelativePath)
            }
          }
        } catch (error) {
          logger.error({ err: error, path: dirPath }, 'Error searching directory')
        }
      }

      if (MEMORY_ALLOWED_PREFIXES.length) {
        for (const prefix of MEMORY_ALLOWED_PREFIXES) {
          const folder = prefix.replace(/\/$/, '')
          const fullPath = join(MEMORY_PATH, folder)
          if (!existsSync(fullPath)) continue
          await searchDirectory(fullPath, folder)
        }
      } else {
        await searchDirectory(MEMORY_PATH)
      }
      
      return NextResponse.json({ 
        query,
        results: results.sort((a, b) => b.matches - a.matches)
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Memory API error')
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
    const { action, path, content } = body

    if (!path) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }
    if (!isPathAllowed(path)) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }

    if (!MEMORY_PATH) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
    }
    const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path)

    if (action === 'save') {
      // Save file content
      if (content === undefined) {
        return NextResponse.json({ error: 'Content is required for save action' }, { status: 400 })
      }

      // Validate schema if present (warn but don't block save)
      const schemaResult = path.endsWith('.md') ? validateSchema(content) : null
      const schemaWarnings = schemaResult?.errors ?? []

      await writeFile(fullPath, content, 'utf-8')
      try {
        db_helpers.logActivity('memory_file_saved', 'memory', 0, auth.user.username || 'unknown', `Updated ${path}`, { path, size: content.length })
      } catch { /* best-effort */ }
      return NextResponse.json({
        success: true,
        message: 'File saved successfully',
        schemaWarnings,
      })
    }

    if (action === 'create') {
      // Create new file
      const dirPath = dirname(fullPath)
      
      // Ensure directory exists
      try {
        await mkdir(dirPath, { recursive: true })
      } catch (error) {
        // Directory might already exist
      }

      // Check if file already exists
      try {
        await stat(fullPath)
        return NextResponse.json({ error: 'File already exists' }, { status: 409 })
      } catch (error) {
        // File doesn't exist, which is what we want
      }

      await writeFile(fullPath, content || '', 'utf-8')
      try {
        db_helpers.logActivity('memory_file_created', 'memory', 0, auth.user.username || 'unknown', `Created ${path}`, { path })
      } catch { /* best-effort */ }
      return NextResponse.json({ success: true, message: 'File created successfully' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Memory POST API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { action, path } = body

    if (!path) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }
    if (!isPathAllowed(path)) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }

    if (!MEMORY_PATH) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
    }
    const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path)

    if (action === 'delete') {
      // Check if file exists
      try {
        await stat(fullPath)
      } catch (error) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      await unlink(fullPath)
      try {
        db_helpers.logActivity('memory_file_deleted', 'memory', 0, auth.user.username || 'unknown', `Deleted ${path}`, { path })
      } catch { /* best-effort */ }
      return NextResponse.json({ success: true, message: 'File deleted successfully' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Memory DELETE API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
