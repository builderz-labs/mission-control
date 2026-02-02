import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat, writeFile, mkdir, unlink } from 'fs/promises'
import { join, dirname } from 'path'

const MEMORY_PATH = '/home/ubuntu/clawd/memory'

interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

async function buildFileTree(dirPath: string, relativePath: string = ''): Promise<MemoryFile[]> {
  try {
    const items = await readdir(dirPath, { withFileTypes: true })
    const files: MemoryFile[] = []

    for (const item of items) {
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
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    const action = searchParams.get('action')

    if (action === 'tree') {
      // Return the file tree
      const tree = await buildFileTree(MEMORY_PATH)
      return NextResponse.json({ tree })
    }

    if (action === 'content' && path) {
      // Return file content
      const fullPath = join(MEMORY_PATH, path)
      
      try {
        // Security check - ensure path is within memory directory
        if (!fullPath.startsWith(MEMORY_PATH)) {
          return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
        }

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

      // Simple file search - in production you'd want a more sophisticated search
      const results: Array<{path: string, name: string, matches: number}> = []
      
      const searchInFile = async (filePath: string, relativePath: string) => {
        try {
          const content = await readFile(filePath, 'utf-8')
          const matches = (content.match(new RegExp(query, 'gi')) || []).length
          
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
  try {
    const body = await request.json()
    const { action, path, content } = body

    if (!path) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const fullPath = join(MEMORY_PATH, path)

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
  try {
    const body = await request.json()
    const { action, path } = body

    if (!path) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const fullPath = join(MEMORY_PATH, path)

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