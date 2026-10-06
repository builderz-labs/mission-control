import { createHash, randomBytes, randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import {
  getSocialSecretProtector,
  putSocialAccount,
  type SecretProtector,
  type SocialProvider,
} from './social-credential-vault'

export interface SocialOAuthProfile {
  provider: SocialProvider
  authorizeUrl: string
  tokenUrl: string
  defaultScopes: readonly string[]
  scopeEncoding: 'space' | 'comma'
  pkce: 'required' | 'optional' | 'none'
  clientAuthentication: 'public_pkce' | 'body_secret' | 'basic_auth' | 'configurable'
  refreshSupported: boolean
  redirectRequirements: string[]
  accountModes?: string[]
}

export const socialOAuthProfiles: readonly SocialOAuthProfile[] = [
  { provider: 'tiktok', authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/', tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/', defaultScopes: ['user.info.basic', 'video.list'], scopeEncoding: 'comma', pkce: 'required', clientAuthentication: 'body_secret', refreshSupported: true, redirectRequirements: ['HTTP localhost/127.0.0.1 loopback is supported; exact registered redirect URI.'] },
  { provider: 'x', authorizeUrl: 'https://x.com/i/oauth2/authorize', tokenUrl: 'https://api.x.com/2/oauth2/token', defaultScopes: ['tweet.read', 'users.read', 'offline.access'], scopeEncoding: 'space', pkce: 'required', clientAuthentication: 'public_pkce', refreshSupported: true, redirectRequirements: ['Exact redirect URI matching; offline.access is required for refresh tokens.'] },
  { provider: 'instagram', authorizeUrl: 'https://www.instagram.com/oauth/authorize', tokenUrl: 'https://api.instagram.com/oauth/access_token', defaultScopes: ['instagram_business_basic'], scopeEncoding: 'comma', pkce: 'none', clientAuthentication: 'body_secret', refreshSupported: true, redirectRequirements: ['Instagram Login for Business/Creator accounts; no Facebook Page required. Insights permission may require Meta approval.'], accountModes: ['business', 'creator'] },
  { provider: 'linkedin', authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken', defaultScopes: [], scopeEncoding: 'space', pkce: 'optional', clientAuthentication: 'configurable', refreshSupported: true, redirectRequirements: ['Confidential 3-legged flow supported; PKCE may require app enablement. Configure approved member/organization scopes.'] },
  { provider: 'reddit', authorizeUrl: 'https://www.reddit.com/api/v1/authorize', tokenUrl: 'https://www.reddit.com/api/v1/access_token', defaultScopes: ['identity', 'read'], scopeEncoding: 'space', pkce: 'optional', clientAuthentication: 'basic_auth', refreshSupported: true, redirectRequirements: ['OAuth user authorization; provide a descriptive User-Agent. Use duration=permanent when refresh access is needed.'] },
] as const

const profileMap = new Map(socialOAuthProfiles.map((profile) => [profile.provider, profile]))
export function getSocialOAuthProfile(provider: string): SocialOAuthProfile | undefined { return profileMap.get(provider as SocialProvider) }

export interface OAuthAppConfigInput {
  provider: SocialProvider
  client_id: string
  client_secret?: string
  redirect_uri: string
  scopes?: string[]
  options?: Record<string, string | boolean>
}

export interface OAuthAppConfigView {
  provider: SocialProvider
  configured: boolean
  client_id: string | null
  redirect_uri: string | null
  scopes: string[]
  options: Record<string, string | boolean>
  status: string
  configured_at: number | null
}

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}

export function listOAuthAppConfigs(db: Database.Database, workspaceId: number): OAuthAppConfigView[] {
  const rows = db.prepare(`SELECT provider, client_id, redirect_uri, scopes, options, status, configured_at
    FROM social_oauth_apps WHERE workspace_id = ? ORDER BY provider`).all(workspaceId) as Array<any>
  const byProvider = new Map(rows.map((row) => [row.provider, row]))
  return socialOAuthProfiles.map((profile) => {
    const row = byProvider.get(profile.provider)
    return row
      ? { provider: row.provider, configured: true, client_id: row.client_id, redirect_uri: row.redirect_uri,
        scopes: parseJson(row.scopes, []), options: parseJson(row.options, {}), status: row.status, configured_at: row.configured_at }
      : { provider: profile.provider, configured: false, client_id: null, redirect_uri: null,
        scopes: [...profile.defaultScopes], options: {}, status: 'not_configured', configured_at: null }
  })
}

export function saveOAuthAppConfig(db: Database.Database, workspaceId: number, actor: string, input: OAuthAppConfigInput,
  protector: SecretProtector = getSocialSecretProtector()): OAuthAppConfigView {
  const profile = getSocialOAuthProfile(input.provider)
  if (!profile || !input.client_id.trim() || input.client_id.length > 500) throw new Error('Invalid OAuth app configuration')
  let redirect: URL
  try { redirect = new URL(input.redirect_uri) } catch { throw new Error('Invalid OAuth app configuration') }
  if (!['https:', 'http:'].includes(redirect.protocol) || redirect.username || redirect.password) throw new Error('Invalid OAuth app configuration')
  if (redirect.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)) throw new Error('Invalid OAuth app configuration')
  const scopes = input.scopes ?? [...profile.defaultScopes]
  if (!Array.isArray(scopes) || scopes.length > 100 || scopes.some((scope) => typeof scope !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(scope))) throw new Error('Invalid OAuth app configuration')
  const options = input.options ?? {}
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length > 20) throw new Error('Invalid OAuth app configuration')
  const permittedOptions: Record<SocialProvider, string[]> = {
    instagram: [], tiktok: [], linkedin: ['pkce_enabled'], x: [], reddit: ['duration', 'user_agent'],
  }
  const optionsJson = JSON.stringify(options)
  if (optionsJson.length > 4000 || Object.entries(options).some(([key, value]) => !permittedOptions[input.provider].includes(key)
    || !(typeof value === 'string' && value.length <= 300 || typeof value === 'boolean'))
    || options.pkce_enabled !== undefined && typeof options.pkce_enabled !== 'boolean'
    || options.duration !== undefined && !['temporary', 'permanent'].includes(String(options.duration))
    || options.user_agent !== undefined && (typeof options.user_agent !== 'string' || !/\S/.test(options.user_agent))) throw new Error('Invalid OAuth app configuration')
  const previous = db.prepare('SELECT protected_client_secret, protector_version FROM social_oauth_apps WHERE workspace_id = ? AND provider = ?').get(workspaceId, input.provider) as any
  let secretBlob = previous?.protected_client_secret ?? null
  let protectorVersion = previous?.protector_version ?? null
  if (input.client_secret !== undefined) {
    if (!input.client_secret || input.client_secret.length > 32768) throw new Error('Invalid OAuth app configuration')
    try { secretBlob = protector.protect(input.client_secret); protectorVersion = protector.version }
    catch { throw new Error('Unable to protect OAuth app secret') }
  }
  const linkedInPublicPkce = input.provider === 'linkedin' && options.pkce_enabled === true
  if (profile.clientAuthentication !== 'public_pkce' && !linkedInPublicPkce && !secretBlob) throw new Error('OAuth app secret is required')
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`INSERT INTO social_oauth_apps (workspace_id, provider, client_id, protected_client_secret, protector_version, redirect_uri, scopes, options, status, configured_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'configured', ?, ?)
    ON CONFLICT(workspace_id, provider) DO UPDATE SET client_id=excluded.client_id, protected_client_secret=excluded.protected_client_secret,
      protector_version=excluded.protector_version, redirect_uri=excluded.redirect_uri, scopes=excluded.scopes,
      options=excluded.options, status='configured', updated_at=excluded.updated_at`)
    .run(workspaceId, input.provider, input.client_id.trim(), secretBlob, protectorVersion, redirect.href, JSON.stringify(scopes), optionsJson, now, now)
  db.prepare(`INSERT INTO audit_log (action, actor, target_type, detail, workspace_id) VALUES ('social_oauth_app_configured', ?, 'social_oauth_app', ?, ?)`)
    .run(actor, JSON.stringify({ provider: input.provider, configured: true }), workspaceId)
  return listOAuthAppConfigs(db, workspaceId).find((config) => config.provider === input.provider)!
}

interface StoredApp extends Omit<OAuthAppConfigView, 'client_id' | 'redirect_uri'> { client_id: string; redirect_uri: string; protected_client_secret: string | null; protector_version: string | null }
function getStoredApp(db: Database.Database, workspaceId: number, provider: SocialProvider): StoredApp | undefined {
  const row = db.prepare(`SELECT provider, client_id, protected_client_secret, protector_version, redirect_uri, scopes, options, status, configured_at
    FROM social_oauth_apps WHERE workspace_id = ? AND provider = ? AND status = 'configured'`).get(workspaceId, provider) as any
  return row && { provider: row.provider, configured: true, client_id: row.client_id, protected_client_secret: row.protected_client_secret,
    protector_version: row.protector_version, redirect_uri: row.redirect_uri, scopes: parseJson(row.scopes, []), options: parseJson(row.options, {}), status: row.status, configured_at: row.configured_at }
}

export function generatePkce(verifier = randomBytes(32).toString('base64url')): { verifier: string; challenge: string } {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('Invalid PKCE verifier')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export interface OAuthStartResult { session_id: string; authorize_url: string; scopes: string[]; expires_at: number }

export function startSocialOAuth(db: Database.Database, workspaceId: number, actor: string, provider: SocialProvider,
  options: { account_mode?: string; random?: (size: number) => Buffer; protector?: SecretProtector; now?: number } = {}): OAuthStartResult {
  const profile = getSocialOAuthProfile(provider)
  const app = getStoredApp(db, workspaceId, provider)
  if (!profile || !app) throw new Error('OAuth app is not configured')
  if (options.account_mode && !profile.accountModes?.includes(options.account_mode)) throw new Error('Invalid account mode')
  const random = options.random ?? randomBytes
  const protector = options.protector ?? getSocialSecretProtector()
  const state = random(32).toString('base64url')
  const stateHash = createHash('sha256').update(state).digest('hex')
  const usePkce = profile.pkce === 'required' || profile.pkce === 'optional' && app.options.pkce_enabled === true
  const pkce = usePkce ? generatePkce(random(32).toString('base64url')) : undefined
  let protectedVerifier: string | null = null
  let protectorVersion: string | null = null
  if (pkce) {
    try { protectedVerifier = protector.protect(pkce.verifier); protectorVersion = protector.version }
    catch { throw new Error('Unable to protect OAuth transaction') }
  }
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const expiresAt = now + 600
  const sessionId = randomUUID()
  db.prepare(`INSERT INTO social_oauth_sessions (workspace_id, session_id, provider, state_hash, protected_code_verifier, protector_version, requested_scopes, redirect_uri, created_at, expires_at, initiated_by, account_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(workspaceId, sessionId, provider, stateHash, protectedVerifier, protectorVersion, JSON.stringify(app.scopes), app.redirect_uri, now, expiresAt, actor, options.account_mode ?? null)
  const url = new URL(profile.authorizeUrl)
  if (provider === 'tiktok') url.searchParams.set('client_key', app.client_id)
  else url.searchParams.set('client_id', app.client_id)
  url.searchParams.set('redirect_uri', app.redirect_uri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', app.scopes.join(profile.scopeEncoding === 'comma' ? ',' : ' '))
  url.searchParams.set('state', state)
  if (provider === 'reddit') url.searchParams.set('duration', app.options.duration === 'temporary' ? 'temporary' : 'permanent')
  if (pkce) { url.searchParams.set('code_challenge', pkce.challenge); url.searchParams.set('code_challenge_method', 'S256') }
  return { session_id: sessionId, authorize_url: url.toString(), scopes: app.scopes, expires_at: expiresAt }
}

interface TokenResult { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string }
export type OAuthFetch = typeof fetch

function extractToken(json: any): TokenResult {
  const data = json?.data && typeof json.data === 'object' ? json.data : json
  if (!data || typeof data.access_token !== 'string' || !data.access_token) throw new Error('OAuth token exchange failed')
  return { access_token: data.access_token, refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
    scope: typeof data.scope === 'string' ? data.scope : undefined }
}

export async function exchangeAuthorizationCode(provider: SocialProvider, app: StoredApp,
  code: string, verifier: string | null, protector: SecretProtector, fetcher: OAuthFetch = fetch): Promise<TokenResult> {
  const profile = getSocialOAuthProfile(provider)
  if (!profile || !code || code.length > 8192) throw new Error('OAuth token exchange failed')
  let clientSecret: string | undefined
  if (app.protected_client_secret) {
    try { clientSecret = protector.unprotect(app.protected_client_secret) } catch { throw new Error('OAuth token exchange failed') }
  }
  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('redirect_uri', app.redirect_uri)
  if (provider === 'tiktok') body.set('client_key', app.client_id)
  else body.set('client_id', app.client_id)
  if (provider === 'instagram') body.set('client_secret', clientSecret ?? '')
  if (provider === 'linkedin' && clientSecret) body.set('client_secret', clientSecret)
  if (provider === 'tiktok' && clientSecret) body.set('client_secret', clientSecret)
  if (verifier) body.set('code_verifier', verifier)
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (profile.clientAuthentication === 'basic_auth' && clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${app.client_id}:${clientSecret}`).toString('base64')}`
    body.delete('client_id')
  }
  if (provider === 'reddit') headers['user-agent'] = String(app.options.user_agent ?? 'ControlTower/1.0 OAuth')
  let response: Response
  try { response = await fetcher(profile.tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) }) }
  catch { throw new Error('OAuth token exchange failed') }
  if (!response.ok) throw new Error('OAuth token exchange failed')
  let json: unknown
  try { json = await response.json() } catch { throw new Error('OAuth token exchange failed') }
  try { return extractToken(json) } catch { throw new Error('OAuth token exchange failed') }
}

export interface OAuthCallbackResult { status: 'connected_pending' | 'cancelled'; provider: SocialProvider; account_id?: string }

export async function completeSocialOAuth(db: Database.Database, workspaceId: number, provider: SocialProvider,
  query: { state: string | null; code: string | null; error?: string | null },
  options: { protector?: SecretProtector; fetcher?: OAuthFetch; now?: number } = {}): Promise<OAuthCallbackResult> {
  const profile = getSocialOAuthProfile(provider)
  if (!profile || !query.state || query.state.length > 256) throw new Error('OAuth transaction is invalid')
  const hash = createHash('sha256').update(query.state).digest('hex')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const row = db.prepare(`SELECT session_id, protected_code_verifier, protector_version, requested_scopes, redirect_uri, expires_at, consumed_at, account_mode, initiated_by
    FROM social_oauth_sessions WHERE workspace_id = ? AND provider = ? AND state_hash = ?`).get(workspaceId, provider, hash) as any
  if (!row || row.consumed_at !== null || row.expires_at <= now) throw new Error('OAuth transaction is invalid')
  const consume = db.prepare(`UPDATE social_oauth_sessions SET consumed_at = ? WHERE workspace_id = ? AND session_id = ? AND consumed_at IS NULL AND expires_at > ?`)
  if (consume.run(now, workspaceId, row.session_id, now).changes !== 1) throw new Error('OAuth transaction is invalid')
  if (query.error) return { status: 'cancelled', provider }
  if (!query.code || query.code.length > 8192) throw new Error('OAuth callback is invalid')
  const app = getStoredApp(db, workspaceId, provider)
  if (!app || app.redirect_uri !== row.redirect_uri) throw new Error('OAuth app configuration changed')
  const protector = options.protector ?? getSocialSecretProtector()
  let verifier: string | null = null
  if (row.protected_code_verifier) {
    try { verifier = protector.unprotect(row.protected_code_verifier) } catch { throw new Error('OAuth transaction is invalid') }
  }
  const token = await exchangeAuthorizationCode(provider, app, query.code, verifier, protector, options.fetcher)
  const credential: Record<string, string> = { access_token: token.access_token }
  if (token.refresh_token) credential.refresh_token = token.refresh_token
  if (token.token_type) credential.token_type = token.token_type
  const account = putSocialAccount(db, workspaceId, row.initiated_by, {
    provider, account_ref: `pending:${randomUUID()}`, status: 'PENDING', account_mode: row.account_mode,
    scopes: parseJson(row.requested_scopes, []), expires_at: token.expires_in ? now + token.expires_in : null,
    refreshable: Boolean(token.refresh_token), credential,
  }, protector)
  db.prepare(`INSERT INTO audit_log (action, actor, target_type, detail, workspace_id) VALUES ('social_oauth_callback_succeeded', 'oauth-callback', 'social_account', ?, ?)`)
    .run(JSON.stringify({ provider, account_id: account.account_id, status: 'PENDING' }), workspaceId)
  return { status: 'connected_pending', provider, account_id: account.account_id }
}
