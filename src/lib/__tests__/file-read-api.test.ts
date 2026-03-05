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
  config: { homeDir: '/mock-home' },
}))

// Mock event-bus
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

// Mock paths
vi.mock('@/lib/paths', () => ({
  resolveWithin: vi.fn((dir: string, base: string) => {
    const resolved = path.resolve(dir, base)
    if (base.includes('..')) throw new Error('Path escapes base directory')
    return resolved
  }),
}))

import { requireRole } from '@/lib/auth'
import { resolveWithin } from '@/lib/paths'

const mockedRequireRole = vi.mocked(requireRole)
const mockedResolveWithin = vi.mocked(resolveWithin)

function makeRequest(queryPath: string): NextRequest {
  return new NextRequest(`http://localhost/api/files/read?path=${encodeURIComponent(queryPath)}`)
}

// Import handler after mocks
let GET: (req: NextRequest) => Promise<Response>

beforeEach(async () => {
  vi.restoreAllMocks()
  // Default: authenticated user
  mockedRequireRole.mockReturnValue({ user: { id: 1, username: 'test', role: 'admin' } } as any)
  // Re-setup resolveWithin default
  mockedResolveWithin.mockImplementation((dir: string, base: string) => {
    const resolved = path.resolve(dir, base)
    if (base.includes('..')) throw new Error('Path escapes base directory')
    return resolved
  })
  // Dynamic import to get fresh module
  const mod = await import('@/app/api/files/read/route')
  GET = mod.GET
})

describe('/api/files/read', () => {
  it('returns 401 without authentication', async () => {
    mockedRequireRole.mockReturnValue({ error: 'Authentication required', status: 401 })
    const res = await GET(makeRequest('/tmp/test.txt'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Authentication required')
  })

  it('returns 400 when path is empty', async () => {
    const req = new NextRequest('http://localhost/api/files/read')
    const res = await GET(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Path required')
  })

  it('returns 400 for unsupported file extension', async () => {
    const res = await GET(makeRequest('/tmp/test.exe'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unsupported file extension')
  })

  it('returns 400 for files with no extension', async () => {
    const res = await GET(makeRequest('/tmp/Makefile'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('(none)')
  })

  it('returns 403 for path traversal attempts', async () => {
    mockedResolveWithin.mockImplementation(() => {
      throw new Error('Path escapes base directory')
    })
    const res = await GET(makeRequest('/tmp/../../etc/passwd.txt'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Path not allowed')
  })

  it('returns 404 when file does not exist', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const res = await GET(makeRequest('/tmp/missing.txt'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('File not found')
  })

  it('returns file content for valid text file', async () => {
    const content = 'hello\nworld\n'
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: content.length } as any)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(content)

    const res = await GET(makeRequest('/tmp/test.txt'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toBe(content)
    expect(body.size).toBe(content.length)
    expect(body.truncated).toBe(false)
  })

  it('expands tilde paths', async () => {
    const content = 'data'
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: 4 } as any)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(content)

    const res = await GET(makeRequest('~/docs/file.csv'))
    expect(res.status).toBe(200)
    // Verify resolveWithin was called with expanded path
    expect(mockedResolveWithin).toHaveBeenCalledWith(
      expect.stringContaining('/mock-home'),
      'file.csv'
    )
  })

  it('truncates files exceeding MAX_LINES', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`)
    const content = lines.join('\n')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: content.length } as any)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(content)

    const res = await GET(makeRequest('/tmp/big.log'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.truncated).toBe(true)
    expect(body.content.split('\n').length).toBeLessThanOrEqual(200)
  })

  it('returns 400 for directories', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => false } as any)

    const res = await GET(makeRequest('/tmp/somedir.json'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Not a file')
  })

  it('accepts all allowed extensions', async () => {
    const extensions = ['.csv', '.txt', '.json', '.md', '.log', '.xml', '.yaml', '.yml', '.tsv', '.html']
    for (const ext of extensions) {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: 5 } as any)
      vi.spyOn(fs, 'readFileSync').mockReturnValue('test\n')

      const res = await GET(makeRequest(`/tmp/file${ext}`))
      expect(res.status).toBe(200)
    }
  })
})
