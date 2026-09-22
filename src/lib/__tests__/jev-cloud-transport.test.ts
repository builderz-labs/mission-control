// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverJevCloudEvent, getJevCloudConfiguration } from '@/lib/jev-cloud-transport'

const env = { MC_SUPABASE_URL: 'https://nivlxzlxnfsgashuomxb.supabase.co',
  MC_SUPABASE_PROJECT_REF: 'nivlxzlxnfsgashuomxb', MC_SUPABASE_SECRET_KEY: 'sb_secret_synthetic' }
afterEach(() => vi.unstubAllGlobals())

describe('Jev cloud transport boundary', () => {
  it.each([
    'http://nivlxzlxnfsgashuomxb.supabase.co', 'https://nivlxzlxnfsgashuomxb.supabase.co.attacker.example',
    'https://nivlxzlxnfsgashuomxb.supabase.co:444', 'https://user:pass@nivlxzlxnfsgashuomxb.supabase.co',
    'https://nivlxzlxnfsgashuomxb.supabase.co/path', 'https://nivlxzlxnfsgashuomxb.supabase.co?leak=1',
  ])('rejects an unauthorized destination: %s', (url) => {
    expect(() => getJevCloudConfiguration({ ...env, MC_SUPABASE_URL: url })).toThrow('CONFIGURATION_INVALID')
  })

  it('requires the selected project, a secret API key, and a server runtime', () => {
    expect(getJevCloudConfiguration({})).toBeNull()
    expect(() => getJevCloudConfiguration({ ...env, MC_SUPABASE_PROJECT_REF: 'another' })).toThrow()
    expect(() => getJevCloudConfiguration({ ...env, MC_SUPABASE_SECRET_KEY: 'publishable' })).toThrow()
    vi.stubGlobal('window', {})
    expect(() => getJevCloudConfiguration(env)).toThrow('SERVER_ONLY')
  })

  it('uses apikey only, rejects redirects, and sends a timeout signal with an idempotent POST', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    await deliverJevCloudEvent(getJevCloudConfiguration(env)!, '{"event_id":"synthetic"}', request)
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error',
      headers: { apikey: env.MC_SUPABASE_SECRET_KEY, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    })
    expect(request.mock.calls[0][1].headers.Authorization).toBeUndefined()
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(request.mock.calls[0][0]).toContain('on_conflict=origin_instance_id,event_id')
  })

  it('retries exactly once and never exposes provider error bodies', async () => {
    const request = vi.fn().mockResolvedValue(new Response('sensitive details', { status: 403 }))
    await expect(deliverJevCloudEvent(getJevCloudConfiguration(env)!, '{}', request)).rejects.toThrow('ACCESS_DENIED')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
