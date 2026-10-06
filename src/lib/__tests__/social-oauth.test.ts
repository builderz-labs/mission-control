import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'
import { getSocialCredential, InMemorySecretProtector } from '../social-credential-vault'
import {
  completeSocialOAuth,
  generatePkce,
  getSocialOAuthProfile,
  listOAuthAppConfigs,
  saveOAuthAppConfig,
  socialOAuthProfiles,
  startSocialOAuth,
} from '../social-oauth'

let db: Database.Database
let protector: InMemorySecretProtector
beforeEach(() => { db = new Database(':memory:'); runMigrations(db); protector = new InMemorySecretProtector() })
afterEach(() => db.close())

function configure(provider: 'instagram' | 'tiktok' | 'linkedin' | 'x' | 'reddit', workspaceId = 1) {
  return saveOAuthAppConfig(db, workspaceId, 'admin', {
    provider, client_id: `${provider}-client`, client_secret: ['x', 'linkedin'].includes(provider) ? undefined : `${provider}-secret`,
    redirect_uri: `https://app.example.test/api/marketing/social-oauth/${provider}/callback`,
    scopes: [...(getSocialOAuthProfile(provider)!.defaultScopes)],
    options: provider === 'linkedin' ? { pkce_enabled: true } : provider === 'reddit' ? { user_agent: 'ControlTower/1.0 (contact ops@example.test)' } : {},
  }, protector)
}

function mockFetch(capture: (url: string, init?: RequestInit) => void, response: unknown = { access_token: 'access-token-secret', refresh_token: 'refresh-token-secret', expires_in: 3600 }) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    capture(String(input), init)
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('social OAuth provider profiles and transactions', () => {
  it('registers all five providers and provider flow metadata', () => {
    expect(socialOAuthProfiles.map((profile) => profile.provider).sort()).toEqual(['instagram', 'linkedin', 'reddit', 'tiktok', 'x'])
    expect(getSocialOAuthProfile('x')?.defaultScopes).toEqual(['tweet.read', 'users.read', 'offline.access'])
    expect(getSocialOAuthProfile('instagram')?.defaultScopes).toContain('instagram_business_basic')
    expect(getSocialOAuthProfile('tiktok')?.pkce).toBe('required')
  })

  it('creates deterministic S256 PKCE values with an injected verifier', () => {
    const result = generatePkce('A'.repeat(43))
    expect(result.verifier).toBe('A'.repeat(43))
    expect(result.challenge).toBe('DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo')
  })

  it('starts with a secret-free authorization response and stores only a state hash', () => {
    configure('tiktok')
    const result = startSocialOAuth(db, 1, 'admin', 'tiktok', { protector, random: (size) => Buffer.alloc(size, 7), now: 1000 })
    const url = new URL(result.authorize_url)
    const body = JSON.stringify(result)
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('user.info.basic,video.list')
    expect(body).not.toMatch(/code_verifier|client_secret|tiktok-secret/)
    const row = db.prepare('SELECT state_hash, protected_code_verifier FROM social_oauth_sessions').get() as any
    expect(row.state_hash).not.toBe(url.searchParams.get('state'))
    expect(row.protected_code_verifier).not.toBe('A'.repeat(43))
    expect(result.scopes).toEqual(['user.info.basic', 'video.list'])
  })

  it('fails closed for expired, mismatched, replayed, and cross-workspace callbacks', async () => {
    configure('x')
    const expired = startSocialOAuth(db, 1, 'admin', 'x', { protector, now: 1000 })
    const expiredState = new URL(expired.authorize_url).searchParams.get('state')!
    await expect(completeSocialOAuth(db, 1, 'x', { state: expiredState, code: 'code' }, { protector, now: 1601, fetcher: mockFetch(() => {}) })).rejects.toThrow('invalid')

    const started = startSocialOAuth(db, 1, 'admin', 'x', { protector, now: 2000 })
    const state = new URL(started.authorize_url).searchParams.get('state')!
    await expect(completeSocialOAuth(db, 1, 'x', { state: `${state}wrong`, code: 'code' }, { protector, fetcher: mockFetch(() => {}) })).rejects.toThrow('invalid')
    await expect(completeSocialOAuth(db, 2, 'x', { state, code: 'code' }, { protector, fetcher: mockFetch(() => {}) })).rejects.toThrow('invalid')
    await completeSocialOAuth(db, 1, 'x', { state, error: 'access_denied', code: null }, { protector, now: 2001 })
    await expect(completeSocialOAuth(db, 1, 'x', { state, code: 'replay' }, { protector, fetcher: mockFetch(() => {}) })).rejects.toThrow('invalid')
  })


  it('builds provider-specific authorize URLs without leaking or inventing parameters', () => {
    for (const provider of ['instagram', 'tiktok', 'linkedin', 'x', 'reddit'] as const) {
      configure(provider)
      const started = startSocialOAuth(db, 1, 'admin', provider, { protector, random: (size) => Buffer.alloc(size, 9), now: 2500 })
      const url = new URL(started.authorize_url)
      expect(url.searchParams.get('state')).toBeTruthy()
      expect(url.searchParams.get('redirect_uri')).toContain('/social-oauth/')
      expect(url.searchParams.has('client_secret')).toBe(false)
      if (provider === 'tiktok') {
        expect(url.searchParams.get('client_key')).toBe('tiktok-client')
        expect(url.searchParams.has('client_id')).toBe(false)
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      } else {
        expect(url.searchParams.get('client_id')).toBe(`${provider}-client`)
      }
      if (provider === 'reddit') {
        expect(url.searchParams.get('duration')).toBe('permanent')
        expect(url.searchParams.has('user_agent')).toBe(false)
      }
      if (provider === 'linkedin') {
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      }
    }
  })

  it('builds mocked offline exchange requests and parses fixtures for all providers', async () => {
    for (const profile of socialOAuthProfiles) {
      configure(profile.provider)
      const started = startSocialOAuth(db, 1, 'admin', profile.provider, { protector, now: 3000 })
      const state = new URL(started.authorize_url).searchParams.get('state')!
      let capturedUrl = ''
      let capturedInit: RequestInit | undefined
      const fetcher = mockFetch((url, init) => { capturedUrl = url; capturedInit = init })
      const result = await completeSocialOAuth(db, 1, profile.provider, { state, code: 'fixture-auth-code' }, { protector, fetcher, now: 3001 })
      expect(result.status).toBe('connected_pending')
      expect(capturedUrl).toBe(profile.tokenUrl)
      expect(capturedInit?.method).toBe('POST')
      expect(capturedInit?.signal).toBeInstanceOf(AbortSignal)
      const body = new URLSearchParams(capturedInit?.body as URLSearchParams)
      expect(body.get('code')).toBe('fixture-auth-code')
      expect(fetcher).toHaveBeenCalledTimes(1)
      if (profile.provider === 'tiktok') {
        expect(body.get('client_key')).toBe('tiktok-client')
        expect(body.get('client_id')).toBeNull()
        expect(body.get('client_secret')).toBe('tiktok-secret')
        expect(body.get('code_verifier')).toBeTruthy()
      }
      if (profile.provider === 'x') {
        expect(body.get('client_id')).toBe('x-client')
        expect(body.get('client_secret')).toBeNull()
        expect(body.get('code_verifier')).toBeTruthy()
      }
      if (profile.provider === 'linkedin') {
        expect(body.get('client_id')).toBe('linkedin-client')
        expect(body.get('client_secret')).toBeNull()
        expect(body.get('code_verifier')).toBeTruthy()
      }
      if (profile.provider === 'instagram') {
        expect(body.get('client_id')).toBe('instagram-client')
        expect(body.get('client_secret')).toBe('instagram-secret')
        expect(body.get('code_verifier')).toBeNull()
      }
      if (profile.provider === 'reddit') {
        expect((capturedInit?.headers as Record<string, string>)['user-agent']).toContain('ControlTower')
        expect((capturedInit?.headers as Record<string, string>).authorization).toMatch(/^Basic /)
        expect(body.get('client_id')).toBeNull()
      }
    }
  })

  it('stores returned tokens protected and creates only pending secret-free account metadata', async () => {
    configure('x')
    const started = startSocialOAuth(db, 1, 'admin', 'x', { protector })
    const state = new URL(started.authorize_url).searchParams.get('state')!
    const result = await completeSocialOAuth(db, 1, 'x', { state, code: 'code' }, { protector, fetcher: mockFetch(() => {}) })
    expect(result.account_id).toBeTruthy()
    const accountRow = db.prepare('SELECT status, account_ref FROM social_accounts').get() as any
    expect(accountRow.status).toBe('PENDING')
    expect(accountRow.account_ref).toMatch(/^pending:/)
    expect(JSON.stringify(db.prepare('SELECT * FROM social_accounts').get())).not.toMatch(/access-token-secret|refresh-token-secret/)
    const account = db.prepare('SELECT credential_ref FROM social_accounts').get() as any
    expect(getSocialCredential(db, 1, account.credential_ref, protector)).toEqual({ access_token: 'access-token-secret', refresh_token: 'refresh-token-secret' })
    const blob = (db.prepare("SELECT protected_blob FROM social_credentials WHERE provider = 'x'").get() as any).protected_blob
    expect(blob).not.toContain('access-token-secret')
    expect(JSON.stringify(db.prepare('SELECT detail FROM audit_log').all())).not.toMatch(/access-token-secret|refresh-token-secret|fixture-auth-code/)
  })

  it('stores CONNECTED accounts only after verified Instagram, TikTok, and X identity lookup', async () => {
    for (const provider of ['instagram', 'tiktok', 'x'] as const) {
      configure(provider)
      const started = startSocialOAuth(db, 1, 'admin', provider, { protector })
      const state = new URL(started.authorize_url).searchParams.get('state')!
      let calls = 0
      const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls += 1
        if (calls === 1) {
          return new Response(JSON.stringify({ access_token: 'verified-access-token', refresh_token: 'verified-refresh-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer verified-access-token')
        if (provider === 'instagram') {
          expect(String(input)).toBe('https://graph.instagram.com/v26.0/me?fields=user_id,username')
          return new Response(JSON.stringify({ user_id: '17841400000000000', username: 'creator_ig' }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (provider === 'tiktok') {
          expect(String(input)).toContain('https://open.tiktokapis.com/v2/user/info/')
          return new Response(JSON.stringify({ data: { user: { open_id: '0a1b2c3d-4e5f-6789-abcd-0123456789ef', display_name: 'Creator' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        expect(String(input)).toBe('https://api.x.com/2/users/me')
        return new Response(JSON.stringify({ data: { id: '123456789', name: 'Builder', username: 'builder' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as unknown as typeof fetch

      const result = await completeSocialOAuth(db, 1, provider, { state, code: 'verified-code' }, { protector, fetcher, verifyIdentity: true })
      expect(result.status).toBe('connected')
      expect(fetcher).toHaveBeenCalledTimes(2)
      const row = db.prepare('SELECT status, account_ref, external_account_id FROM social_accounts WHERE provider = ?').get(provider) as any
      expect(row.status).toBe('CONNECTED')
      if (provider === 'instagram') {
        expect(row.account_ref).toBe('@creator_ig')
        expect(row.external_account_id).toBe('instagram:17841400000000000')
      } else if (provider === 'tiktok') {
        expect(row.account_ref).toBe('TikTok: Creator')
        expect(row.external_account_id).toBe('tiktok:0a1b2c3d-4e5f-6789-abcd-0123456789ef')
      } else {
        expect(row.account_ref).toBe('@builder')
        expect(row.external_account_id).toBe('x:123456789')
      }
    }
  })

  it('persists nothing when required Instagram identity verification fails', async () => {
    configure('instagram')
    const started = startSocialOAuth(db, 1, 'admin', 'instagram', { protector })
    const state = new URL(started.authorize_url).searchParams.get('state')!
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return new Response(JSON.stringify({ access_token: 'verified-access-token', refresh_token: 'verified-refresh-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: 'provider unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    await expect(completeSocialOAuth(db, 1, 'instagram', { state, code: 'verified-code' }, { protector, fetcher, verifyIdentity: true }))
      .rejects.toThrow('OAuth identity verification failed')
    expect(db.prepare('SELECT count(*) AS count FROM social_accounts').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT count(*) AS count FROM social_credentials').get()).toEqual({ count: 0 })
  })

  it('does not create a connected account or leak provider secrets after exchange failure', async () => {
    configure('instagram')
    const started = startSocialOAuth(db, 1, 'admin', 'instagram', { protector })
    const state = new URL(started.authorize_url).searchParams.get('state')!
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'private-secret-error' }), { status: 400 })) as unknown as typeof fetch
    await expect(completeSocialOAuth(db, 1, 'instagram', { state, code: 'private-code' }, { protector, fetcher })).rejects.toThrow('OAuth token exchange failed')
    expect(db.prepare('SELECT count(*) AS count FROM social_accounts').get()).toEqual({ count: 0 })
    await expect(completeSocialOAuth(db, 1, 'instagram', { state, code: 'retry-code' }, { protector, fetcher })).rejects.toThrow('invalid')
    expect(JSON.stringify(db.prepare('SELECT detail FROM audit_log').all())).not.toMatch(/private-secret|private-code|retry-code/)
  })

  it('isolates app configurations and protects client secrets at rest', () => {
    configure('reddit', 1)
    configure('reddit', 2)
    const row = db.prepare("SELECT protected_client_secret FROM social_oauth_apps WHERE workspace_id = 1 AND provider = 'reddit'").get() as any
    expect(row.protected_client_secret).not.toContain('reddit-secret')
    expect(JSON.stringify(listOAuthAppConfigs(db, 1))).not.toMatch(/reddit-secret|protected_client_secret/)
    expect(listOAuthAppConfigs(db, 1)).toHaveLength(5)
    expect(listOAuthAppConfigs(db, 2)).toHaveLength(5)
  })
})

const apiState = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/db', () => ({ getDatabase: () => apiState.db }))
vi.mock('@/lib/auth', () => ({ requireRole: () => ({ user: { username: 'admin', workspace_id: 1 } }) }))

describe('social OAuth app config API', () => {
  it('redacts client secrets in list response', async () => {
    apiState.db = db
    configure('x')
    const { GET } = await import('../../app/api/marketing/social-oauth/apps/route')
    const response = await GET(new NextRequest('http://localhost/api/marketing/social-oauth/apps'))
    const text = JSON.stringify(await response.json())
    expect(text).toContain('x-client')
    expect(text).not.toMatch(/x-secret|client_secret|protected_client_secret/)
    expect(JSON.parse(text).apps.filter((app: any) => !app.configured)).toHaveLength(4)
    apiState.db = null
  })
})
