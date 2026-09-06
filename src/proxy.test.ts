import { describe, expect, it, vi } from 'vitest'

function setNodeEnv(value: string) {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
}

describe('proxy host matching', () => {
  it('adds browser security policy and HSTS to HTTPS responses', async () => {
    vi.resetModules()
    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'localhost:3000', 'x-forwarded-proto': 'https' }),
      nextUrl: {
        host: 'localhost:3000', hostname: 'localhost', pathname: '/login', protocol: 'https:',
        clone: () => ({ pathname: '/login' }),
      },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    const response = proxy(request)
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups')
    expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000')
  })

  it('allows the system hostname implicitly', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'hetzner-jarv' },
      hostname: () => 'hetzner-jarv',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'hetzner-jarv' }),
      nextUrl: { host: 'hetzner-jarv', hostname: 'hetzner-jarv', pathname: '/login', clone: () => ({ pathname: '/login' }) },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    process.env.MC_ALLOWED_HOSTS = 'localhost,127.0.0.1'
    delete process.env.MC_ALLOW_ANY_HOST

    const response = proxy(request)
    expect(response.status).not.toBe(403)
  })

  it('keeps blocking unrelated hosts in production', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'hetzner-jarv' },
      hostname: () => 'hetzner-jarv',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'evil.example.com' }),
      nextUrl: { host: 'evil.example.com', hostname: 'evil.example.com', pathname: '/login', clone: () => ({ pathname: '/login' }) },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    process.env.MC_ALLOWED_HOSTS = 'localhost,127.0.0.1'
    delete process.env.MC_ALLOW_ANY_HOST

    const response = proxy(request)
    expect(response.status).toBe(403)
  })

  it('allows unauthenticated health probe for /api/status?action=health', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'hetzner-jarv' },
      hostname: () => 'hetzner-jarv',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'localhost:3000' }),
      nextUrl: {
        host: 'localhost:3000',
        hostname: 'localhost',
        pathname: '/api/status',
        searchParams: new URLSearchParams('action=health'),
        clone: () => ({ pathname: '/api/status' }),
      },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    process.env.MC_ALLOWED_HOSTS = 'localhost,127.0.0.1'
    delete process.env.MC_ALLOW_ANY_HOST

    const response = proxy(request)
    expect(response.status).not.toBe(401)
  })

  it('keeps host validation for a Fly private health probe', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({ default: { hostname: () => 'control' }, hostname: () => 'control' }))
    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: '[fdaa:75:746e:a7b:7d4:8b00:8857:2]:3000' }),
      nextUrl: { host: '[fdaa:75:746e:a7b:7d4:8b00:8857:2]:3000', hostname: 'fdaa:75:746e:a7b:7d4:8b00:8857:2', pathname: '/api/health', searchParams: new URLSearchParams(), clone: () => ({ pathname: '/api/health' }) },
      method: 'GET', cookies: { get: () => undefined },
    } as any
    setNodeEnv('production'); process.env.MC_ALLOWED_HOSTS = 'mission-control-control-tyler.fly.dev'; delete process.env.MC_ALLOW_ANY_HOST
    expect(proxy(request).status).toBe(403)
  })

  it('still blocks unauthenticated non-health status API calls', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'hetzner-jarv' },
      hostname: () => 'hetzner-jarv',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'localhost:3000' }),
      nextUrl: {
        host: 'localhost:3000',
        hostname: 'localhost',
        pathname: '/api/status',
        searchParams: new URLSearchParams('action=overview'),
        clone: () => ({ pathname: '/api/status' }),
      },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    process.env.MC_ALLOWED_HOSTS = 'localhost,127.0.0.1'
    delete process.env.MC_ALLOW_ANY_HOST

    const response = proxy(request)
    expect(response.status).toBe(401)
  })

  it.each([
    ['dashboard-rotated mc_ key', 'mc_' + 'a1b2c3d4'.repeat(6)],
    ['agent-scoped mca_ key', 'mca_' + 'a1b2c3d4'.repeat(6)],
  ])('lets a %s through to route auth (issue #733)', async (_label, key) => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'hetzner-jarv' },
      hostname: () => 'hetzner-jarv',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'localhost:3000', 'x-api-key': key }),
      nextUrl: {
        host: 'localhost:3000',
        hostname: 'localhost',
        pathname: '/api/tasks',
        searchParams: new URLSearchParams(),
        clone: () => ({ pathname: '/api/tasks' }),
      },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    process.env.MC_ALLOWED_HOSTS = 'localhost,127.0.0.1'
    delete process.env.MC_ALLOW_ANY_HOST
    delete process.env.API_KEY

    const response = proxy(request)
    expect(response.status).not.toBe(401)
  })

  it('still rejects malformed API keys at the proxy gate', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'hetzner-jarv' },
      hostname: () => 'hetzner-jarv',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'localhost:3000', 'x-api-key': 'mc_not-hex-and-too-short' }),
      nextUrl: {
        host: 'localhost:3000',
        hostname: 'localhost',
        pathname: '/api/tasks',
        searchParams: new URLSearchParams(),
        clone: () => ({ pathname: '/api/tasks' }),
      },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    process.env.MC_ALLOWED_HOSTS = 'localhost,127.0.0.1'
    delete process.env.MC_ALLOW_ANY_HOST
    delete process.env.API_KEY

    const response = proxy(request)
    expect(response.status).toBe(401)
  })

  it('fails closed in production when MC_ALLOWED_HOSTS is empty and MC_ALLOW_ANY_HOST is not set', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'local-box' },
      hostname: () => 'local-box',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'evil.example.com' }),
      nextUrl: { host: 'evil.example.com', hostname: 'evil.example.com', pathname: '/login', clone: () => ({ pathname: '/login' }) },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    delete process.env.MC_ALLOWED_HOSTS
    delete process.env.MC_ALLOW_ANY_HOST

    const response = proxy(request)
    expect(response.status).toBe(403)
  })

  it('allows localhost in production when MC_ALLOWED_HOSTS is empty and MC_ALLOW_ANY_HOST is not set', async () => {
    vi.resetModules()
    vi.doMock('node:os', () => ({
      default: { hostname: () => 'local-box' },
      hostname: () => 'local-box',
    }))

    const { proxy } = await import('./proxy')
    const request = {
      headers: new Headers({ host: 'localhost' }),
      nextUrl: { host: 'localhost', hostname: 'localhost', pathname: '/login', clone: () => ({ pathname: '/login' }) },
      method: 'GET',
      cookies: { get: () => undefined },
    } as any

    setNodeEnv('production')
    delete process.env.MC_ALLOWED_HOSTS
    delete process.env.MC_ALLOW_ANY_HOST

    const response = proxy(request)
    expect(response.status).not.toBe(403)
  })
})
