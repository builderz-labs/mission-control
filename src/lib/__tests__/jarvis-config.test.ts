/**
 * Tests for src/lib/jarvis/config.ts
 * Uses vi.stubEnv so the real module reads from the mutated process.env.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getJarvisBaseUrl,
  isJarvisEnabled,
  isJarvisEnabledClient,
  getJarvisWsUrl,
} from '../jarvis/config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getJarvisBaseUrl', () => {
  it('returns default localhost:8340 URL when no env vars set', () => {
    expect(getJarvisBaseUrl()).toBe('http://localhost:8340')
  })

  it('uses JARVIS_HOST override', () => {
    vi.stubEnv('JARVIS_HOST', '192.168.1.10')
    expect(getJarvisBaseUrl()).toBe('http://192.168.1.10:8340')
  })

  it('uses JARVIS_PORT override', () => {
    vi.stubEnv('JARVIS_PORT', '9000')
    expect(getJarvisBaseUrl()).toBe('http://localhost:9000')
  })

  it('uses both JARVIS_HOST and JARVIS_PORT overrides', () => {
    vi.stubEnv('JARVIS_HOST', 'ai.example.com')
    vi.stubEnv('JARVIS_PORT', '443')
    expect(getJarvisBaseUrl()).toBe('http://ai.example.com:443')
  })
})

describe('isJarvisEnabled', () => {
  it('returns false when JARVIS_ENABLED is not set', () => {
    vi.unstubAllEnvs()
    expect(isJarvisEnabled()).toBe(false)
  })

  it('returns false when set to "false"', () => {
    vi.stubEnv('JARVIS_ENABLED', 'false')
    expect(isJarvisEnabled()).toBe(false)
  })

  it('returns false when set to "1" (only "true" is accepted)', () => {
    vi.stubEnv('JARVIS_ENABLED', '1')
    expect(isJarvisEnabled()).toBe(false)
  })

  it('returns true when set to "true"', () => {
    vi.stubEnv('JARVIS_ENABLED', 'true')
    expect(isJarvisEnabled()).toBe(true)
  })
})

describe('isJarvisEnabledClient', () => {
  it('returns false when NEXT_PUBLIC_JARVIS_ENABLED is not set', () => {
    vi.unstubAllEnvs()
    expect(isJarvisEnabledClient()).toBe(false)
  })

  it('returns true when set to "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_JARVIS_ENABLED', 'true')
    expect(isJarvisEnabledClient()).toBe(true)
  })

  it('returns false for any value other than "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_JARVIS_ENABLED', 'yes')
    expect(isJarvisEnabledClient()).toBe(false)
  })
})

describe('getJarvisWsUrl', () => {
  it('returns default ws://localhost:8340 when no env vars set', () => {
    vi.unstubAllEnvs()
    expect(getJarvisWsUrl()).toBe('ws://localhost:8340')
  })

  it('prefers NEXT_PUBLIC_JARVIS_WS_URL over host/port env vars', () => {
    vi.stubEnv('NEXT_PUBLIC_JARVIS_WS_URL', 'wss://jarvis.example.com/ws')
    vi.stubEnv('NEXT_PUBLIC_JARVIS_HOST', 'other.host.com')
    vi.stubEnv('NEXT_PUBLIC_JARVIS_PORT', '9999')
    expect(getJarvisWsUrl()).toBe('wss://jarvis.example.com/ws')
  })

  it('uses NEXT_PUBLIC_JARVIS_HOST override', () => {
    vi.stubEnv('NEXT_PUBLIC_JARVIS_HOST', 'my-jarvis.local')
    expect(getJarvisWsUrl()).toBe('ws://my-jarvis.local:8340')
  })

  it('uses NEXT_PUBLIC_JARVIS_PORT override', () => {
    vi.stubEnv('NEXT_PUBLIC_JARVIS_PORT', '8765')
    expect(getJarvisWsUrl()).toBe('ws://localhost:8765')
  })
})
