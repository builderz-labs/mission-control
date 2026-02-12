import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat, lstat, realpath, writeFile, mkdir, unlink } from 'fs/promises'
import { join, dirname, sep } from 'path'
import { config } from '@/lib/config'
import { resolveWithin } from '@/lib/paths'
import { requireRole } from '@/lib/auth'

const MEMORY_PATH = config.memoryDir

interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

function isWithinBase(base: string, candidate: string): boolean {
  if (candidate === base) return true
  return candidate.startsWith(base + sep)
}

async function resolveSafeMemoryPath(baseDir: string, relativePath: string): Promise<string> {
  const baseReal = await realpath(baseDir)
  const fullPath = resolveWithin(baseDir, relativePath)

  // For non-existent paths, validate containment using the parent directory realpath.
  // This also blocks symlinked parent segments that escape the base.
  let parentReal: string
  try {
    parentReal = await realpath(dirname(fullPath))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error('Parent directory not found')
    }
    throw err
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

async function buildFileTree(dirPath: string, relativePath: string = ''): Promise<MemoryFile[]> {
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
          const children = await buildFileTree(itemPath, itemRelativePath)
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
        console.error(`Error reading ${itemPath}:`, error)
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
    console.error(`Error reading directory ${dirPath}:`, error)
    return []
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    const action = searchParams.get('action')

    if (action === 'tree') {
      // Return the file tree
      if (!MEMORY_PATH) {
        return NextResponse.json({ tree: [] })
      }
      const tree = await buildFileTree(MEMORY_PATH)
      return NextResponse.json({ tree })
    }

    if (action === 'content' && path) {
      // Return file content
      if (!MEMORY_PATH) {
        return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
      }
      const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path)
      
      try {
        const content = await readFile(fullPath, 'utf-8')
        const stats = await stat(fullPath)
        
        return NextResponse.json({
          content,
          size: stats.size,
          modified: stats.mtime.getTime(),
          path
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
          console.error(`Error searching directory ${dirPath}:`, error)
        }
      }

      await searchDirectory(MEMORY_PATH)
      
      return NextResponse.json({ 
        query,
        results: results.sort((a, b) => b.matches - a.matches)
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Memory API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action, path, content } = body

    if (!path) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
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

      await writeFile(fullPath, content, 'utf-8')
      return NextResponse.json({ success: true, message: 'File saved successfully' })
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
      return NextResponse.json({ success: true, message: 'File created successfully' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Memory POST API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action, path } = body

    if (!path) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
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
      return NextResponse.json({ success: true, message: 'File deleted successfully' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Memory DELETE API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
