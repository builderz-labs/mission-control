import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

// Mock auth
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

// Mock config
vi.mock('@/lib/config', () => ({
  config: {
    homeDir: '/mock-home',
    openclawStateDir: '/mock-openclaw',
    memoryDir: '/mock-memory',
  },
}))

// Mock event-bus
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

import { requireRole } from '@/lib/auth'

const mockedRequireRole = vi.mocked(requireRole)

function makeRequest(queryPath: string): NextRequest {
  return new NextRequest(`http://localhost/api/files/read?path=${encodeURIComponent(queryPath)}`)
}

let GET: (req: NextRequest) => Promise<Response>

beforeEach(async () => {
  vi.restoreAllMocks()
  mockedRequireRole.mockReturnValue({ user: { id: 1, username: 'test', role: 'admin', workspace_id: 1 } } as any)
  // Dynamic import to get fresh module
  const mod = await import('@/app/api/files/read/route')
  GET = mod.GET
})

/**
 * Helper: mock filesystem so the file appears to exist and is within an allowed root.
 * realpathSync must resolve both the file and the root to canonical paths.
 */
function mockFileInRoot(filePath: string, root: string, content: string = 'hello\n') {
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: content.length } as any)
  vi.spyOn(fs, 'readFileSync').mockReturnValue(content)
  vi.spyOn(fs, 'realpathSync').mockImplementation((p: fs.PathLike) => {
    const s = String(p)
    // Return canonical paths for known roots and the file
    if (s === root || s.startsWith(root + path.sep)) return s
    if (s === filePath || s.startsWith(filePath)) return s
    return s
  })
}

describe('/api/files/read', () => {
  it('returns 401 without authentication', async () => {
    mockedRequireRole.mockReturnValue({ error: 'Authentication required', status: 401 })
    const res = await GET(makeRequest('/mock-home/test.txt'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when path is empty', async () => {
    const req = new NextRequest('http://localhost/api/files/read')
    const res = await GET(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Path required')
  })

  it('returns 400 for unsupported file extension', async () => {
    const res = await GET(makeRequest('/mock-home/test.exe'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unsupported file extension')
  })

  it('returns 400 for files with no extension', async () => {
    const res = await GET(makeRequest('/mock-home/Makefile'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('(none)')
  })

  it('returns 404 when file does not exist', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const res = await GET(makeRequest('/mock-home/missing.txt'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for directories', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => false } as any)
    const res = await GET(makeRequest('/mock-home/somedir.json'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Not a file')
  })

  it('returns file content for valid file within allowed root', async () => {
    const content = 'hello\nworld\n'
    mockFileInRoot('/mock-home/docs/test.txt', '/mock-home', content)
    const res = await GET(makeRequest('/mock-home/docs/test.txt'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toBe(content)
    expect(body.truncated).toBe(false)
  })

  it('expands tilde paths to home directory', async () => {
    const content = 'data'
    mockFileInRoot('/mock-home/docs/file.csv', '/mock-home', content)
    const res = await GET(makeRequest('~/docs/file.csv'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toBe(content)
  })

  it('truncates files exceeding MAX_LINES', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`)
    const content = lines.join('\n')
    mockFileInRoot('/mock-home/big.log', '/mock-home', content)
    const res = await GET(makeRequest('/mock-home/big.log'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.truncated).toBe(true)
    expect(body.content.split('\n').length).toBeLessThanOrEqual(200)
  })

  it('accepts all allowed extensions', async () => {
    const extensions = ['.csv', '.txt', '.json', '.md', '.log', '.xml', '.yaml', '.yml', '.tsv', '.html']
    for (const ext of extensions) {
      vi.restoreAllMocks()
      mockedRequireRole.mockReturnValue({ user: { id: 1, username: 'test', role: 'admin', workspace_id: 1 } } as any)
      mockFileInRoot(`/mock-home/file${ext}`, '/mock-home', 'test\n')
      const res = await GET(makeRequest(`/mock-home/file${ext}`))
      expect(res.status).toBe(200)
    }
  })

  // --- Trusted-root boundary tests ---

  it('rejects reads outside all allowed roots', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: 10 } as any)
    vi.spyOn(fs, 'realpathSync').mockImplementation((p: fs.PathLike) => String(p))

    const res = await GET(makeRequest('/etc/secrets.txt'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Path not allowed')
  })

  it('rejects reads to /etc/passwd even with allowed extension', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: 10 } as any)
    vi.spyOn(fs, 'realpathSync').mockImplementation((p: fs.PathLike) => String(p))

    const res = await GET(makeRequest('/etc/passwd.txt'))
    expect(res.status).toBe(403)
  })

  it('rejects symlink escapes outside allowed roots', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: 10 } as any)
    // Symlink inside home resolves to outside home
    vi.spyOn(fs, 'realpathSync').mockImplementation((p: fs.PathLike) => {
      const s = String(p)
      if (s === '/mock-home/sneaky-link.txt') return '/etc/shadow'
      return s
    })

    const res = await GET(makeRequest('/mock-home/sneaky-link.txt'))
    expect(res.status).toBe(403)
  })

  it('rejects path traversal via ../ that resolves outside roots', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: 10 } as any)
    vi.spyOn(fs, 'realpathSync').mockImplementation((p: fs.PathLike) => String(p))

    // path.resolve will normalize this to /etc/passwd.txt
    const res = await GET(makeRequest('/mock-home/../etc/passwd.txt'))
    expect(res.status).toBe(403)
  })

  it('allows reads within openclawStateDir root', async () => {
    const content = 'openclaw data'
    mockFileInRoot('/mock-openclaw/workspace/output.json', '/mock-openclaw', content)
    const res = await GET(makeRequest('/mock-openclaw/workspace/output.json'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toBe(content)
  })

  it('allows reads within memoryDir root', async () => {
    const content = 'memory content'
    mockFileInRoot('/mock-memory/notes.md', '/mock-memory', content)
    const res = await GET(makeRequest('/mock-memory/notes.md'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toBe(content)
  })
})
