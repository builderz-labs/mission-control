import { randomUUID } from 'crypto'
import { spawnSync } from 'child_process'
import type Database from 'better-sqlite3'

export type SocialProvider = 'instagram' | 'tiktok' | 'linkedin' | 'x' | 'reddit'
export type SocialAccountStatus = 'PENDING' | 'CONNECTED' | 'EXPIRED' | 'REAUTH_REQUIRED' | 'DISCONNECTED'

export interface SocialCredentialPayload {
  access_token?: string
  refresh_token?: string
  client_secret?: string
  token_type?: string
}

export interface SecretProtector {
  readonly version: string
  protect(secretText: string): string
  unprotect(protectedBlob: string): string
}

/** Uses Windows DPAPI CurrentUser. Secrets are sent to PowerShell over stdin, never argv. */
export class WindowsDpapiCurrentUserProtector implements SecretProtector {
  readonly version = 'windows-dpapi-currentuser-v1'

  private invoke(operation: 'protect' | 'unprotect', input: string): string {
    if (process.platform !== 'win32') throw new Error('Social credential protection is unavailable')
    const script = operation === 'protect'
      ? "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"
      : "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($p)"
    try {
      const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        input: input,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      })
      if (result.error || result.status !== 0 || !result.stdout) {
        throw new Error('protection failed')
      }
      return result.stdout.trim()
    } catch {
      // Never forward child-process diagnostics: they may contain sensitive material.
      throw new Error('Social credential protection failed')
    }
  }

  protect(secretText: string): string {
    return `dpapi:v1:${this.invoke('protect', Buffer.from(secretText, 'utf8').toString('base64'))}`
  }

  unprotect(protectedBlob: string): string {
    const prefix = 'dpapi:v1:'
    if (!protectedBlob.startsWith(prefix)) throw new Error('Social credential protection failed')
    try {
      return Buffer.from(this.invoke('unprotect', protectedBlob.slice(prefix.length)), 'base64').toString('utf8')
    } catch {
      throw new Error('Social credential protection failed')
    }
  }
}

/** Deterministic in-memory test protector. Values are not suitable for persistent runtime use. */
export class InMemorySecretProtector implements SecretProtector {
  readonly version = 'test-memory-v1'
  private readonly values = new Map<string, string>()

  protect(secretText: string): string {
    const blob = `memory:v1:${this.values.size + 1}`
    this.values.set(blob, secretText)
    return blob
  }

  unprotect(protectedBlob: string): string {
    const secret = this.values.get(protectedBlob)
    if (secret === undefined) throw new Error('Social credential protection failed')
    return secret
  }
}

export function getSocialSecretProtector(): SecretProtector {
  if (process.platform !== 'win32') throw new Error('Social credential protection is unavailable')
  return new WindowsDpapiCurrentUserProtector()
}

export interface SocialAccountInput {
  provider: SocialProvider
  account_ref: string
  external_account_id?: string | null
  account_mode?: string | null
  status?: SocialAccountStatus
  scopes?: string[]
  expires_at?: number | null
  refreshable?: boolean
  credential: SocialCredentialPayload
}

export interface SocialAccountView {
  account_id: string
  provider: SocialProvider
  account_ref: string
  external_account_id: string | null
  account_mode: string | null
  status: SocialAccountStatus
  credential_ref: string | null
  scopes: string[]
  expires_at: number | null
  refreshable: boolean
  nonsecret_metadata: Record<string, never>
  created_at: number
  updated_at: number
}

const PROVIDERS = new Set<SocialProvider>(['instagram', 'tiktok', 'linkedin', 'x', 'reddit'])
const STATUSES = new Set<SocialAccountStatus>(['PENDING', 'CONNECTED', 'EXPIRED', 'REAUTH_REQUIRED', 'DISCONNECTED'])
const SECRET_KEYS = new Set(['access_token', 'refresh_token', 'client_secret', 'token_type'])
const TOKEN_SHAPED = /(?:bearer\s+|(?:access|refresh|client)_token\s*[:=]\s*|(?:sk|ya29|gho|ghp|xox[baprs])-[a-z0-9_-]{8,}|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.|ig[a-z0-9._-]{20,}|eaa[a-z0-9]{20,})/i

function rejectSecretLikeMetadata(value: string): string {
  if (TOKEN_SHAPED.test(value) || value.length >= 24 && /[a-z]/i.test(value) && /[0-9]/.test(value) && /^[A-Za-z0-9_+/=-]+$/.test(value)) {
    throw new Error('Invalid social account metadata')
  }
  return value
}

function cleanPayload(value: unknown): SocialCredentialPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid credential payload')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !SECRET_KEYS.has(key))) throw new Error('Invalid credential payload')
  const result: SocialCredentialPayload = {}
  for (const key of SECRET_KEYS) {
    const field = input[key]
    if (field !== undefined) {
      if (typeof field !== 'string' || field.length === 0 || field.length > 32768) throw new Error('Invalid credential payload')
      result[key as keyof SocialCredentialPayload] = field
    }
  }
  if (!result.access_token && !result.refresh_token && !result.client_secret) throw new Error('Invalid credential payload')
  return result
}

function validateInput(input: SocialAccountInput): { payload: string; provider: SocialProvider; view: Omit<SocialAccountView, 'account_id' | 'credential_ref' | 'created_at' | 'updated_at'> } {
  if (!input || !PROVIDERS.has(input.provider)) throw new Error('Invalid social account')
  if (typeof input.account_ref !== 'string' || input.account_ref.trim().length < 1 || input.account_ref.length > 200) throw new Error('Invalid social account')
  const status = input.status ?? 'PENDING'
  if (!STATUSES.has(status)) throw new Error('Invalid social account')
  const scopes = input.scopes ?? []
  if (!Array.isArray(scopes) || scopes.length > 200 || scopes.some((scope) => typeof scope !== 'string' || scope.length > 200)) throw new Error('Invalid social account')
  const nullableString = (value: unknown, max: number) => value == null ? null : typeof value === 'string' && value.length <= max ? rejectSecretLikeMetadata(value) : (() => { throw new Error('Invalid social account') })()
  const expiresAt = input.expires_at ?? null
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt < 0)) throw new Error('Invalid social account')
  if (input.refreshable !== undefined && typeof input.refreshable !== 'boolean') throw new Error('Invalid social account')
  const view = {
    provider: input.provider,
    account_ref: rejectSecretLikeMetadata(input.account_ref.trim()),
    external_account_id: nullableString(input.external_account_id, 300),
    account_mode: nullableString(input.account_mode, 100),
    status,
    scopes: scopes.map((scope) => rejectSecretLikeMetadata(scope)),
    expires_at: expiresAt,
    refreshable: Boolean(input.refreshable),
    nonsecret_metadata: {} as Record<string, never>,
  }
  return { payload: JSON.stringify(cleanPayload(input.credential)), provider: input.provider, view }
}

function mapAccount(row: any): SocialAccountView {
  return {
    account_id: row.account_id,
    provider: row.provider,
    account_ref: row.account_ref,
    external_account_id: row.external_account_id,
    account_mode: row.account_mode,
    status: row.status,
    credential_ref: row.credential_ref,
    scopes: JSON.parse(row.scopes),
    expires_at: row.expires_at,
    refreshable: row.refreshable === 1,
    nonsecret_metadata: {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function audit(db: Database.Database, workspaceId: number, actor: string, action: string, provider: string, accountId: string, status: string): void {
  db.prepare(`
    INSERT INTO audit_log (action, actor, target_type, detail, workspace_id)
    VALUES (?, ?, 'social_account', ?, ?)
  `).run(action, actor, JSON.stringify({ provider, account_id: accountId, status, action }), workspaceId)
}

function accountValues(view: ReturnType<typeof validateInput>['view']) {
  return [view.provider, view.account_ref, view.external_account_id, view.account_mode, view.status,
    JSON.stringify(view.scopes), view.expires_at, view.refreshable ? 1 : 0, '{}']
}

export function listSocialAccounts(db: Database.Database, workspaceId: number): SocialAccountView[] {
  const rows = db.prepare(`SELECT account_id, provider, account_ref, external_account_id, account_mode, status,
    credential_ref, scopes, expires_at, refreshable, created_at, updated_at
    FROM social_accounts WHERE workspace_id = ? ORDER BY created_at DESC`).all(workspaceId)
  return rows.map(mapAccount)
}

export function putSocialAccount(
  db: Database.Database, workspaceId: number, actor: string, input: SocialAccountInput,
  protector: SecretProtector = getSocialSecretProtector(),
): SocialAccountView {
  const validated = validateInput(input)
  let protectedBlob: string
  try { protectedBlob = protector.protect(validated.payload) } catch { throw new Error('Unable to protect social credential') }
  const accountId = randomUUID()
  const credentialRef = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.transaction(() => {
    db.prepare(`INSERT INTO social_credentials (workspace_id, credential_ref, provider, protected_blob, protector_version)
      VALUES (?, ?, ?, ?, ?)`).run(workspaceId, credentialRef, validated.provider, protectedBlob, protector.version)
    db.prepare(`INSERT INTO social_accounts
      (workspace_id, account_id, provider, account_ref, external_account_id, account_mode, status, credential_ref,
       scopes, expires_at, refreshable, nonsecret_metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(workspaceId, accountId, ...accountValues(validated.view).slice(0, 5), credentialRef,
        JSON.stringify(validated.view.scopes), validated.view.expires_at, validated.view.refreshable ? 1 : 0, '{}', now, now)
    audit(db, workspaceId, actor, 'social_credential_saved', validated.provider, accountId, validated.view.status)
  })()
  return mapAccount(db.prepare(`SELECT account_id, provider, account_ref, external_account_id, account_mode, status,
    credential_ref, scopes, expires_at, refreshable, created_at, updated_at FROM social_accounts
    WHERE workspace_id = ? AND account_id = ?`).get(workspaceId, accountId))
}

export function getSocialCredential(db: Database.Database, workspaceId: number, credentialRef: string, protector: SecretProtector = getSocialSecretProtector()): SocialCredentialPayload {
  const row = db.prepare(`SELECT protected_blob FROM social_credentials WHERE workspace_id = ? AND credential_ref = ?`)
    .get(workspaceId, credentialRef) as { protected_blob: string } | undefined
  if (!row) throw new Error('Social credential not found')
  try { return cleanPayload(JSON.parse(protector.unprotect(row.protected_blob))) } catch { throw new Error('Unable to read social credential') }
}

export function rotateSocialCredential(
  db: Database.Database, workspaceId: number, actor: string, accountId: string, credential: SocialCredentialPayload,
  protector: SecretProtector = getSocialSecretProtector(),
): SocialAccountView {
  const payload = JSON.stringify(cleanPayload(credential))
  const row = db.prepare(`SELECT provider, credential_ref, status FROM social_accounts WHERE workspace_id = ? AND account_id = ?`)
    .get(workspaceId, accountId) as { provider: SocialProvider; credential_ref: string | null; status: SocialAccountStatus } | undefined
  if (!row || !row.credential_ref) throw new Error('Social account not found')
  let protectedBlob: string
  try { protectedBlob = protector.protect(payload) } catch { throw new Error('Unable to protect social credential') }
  const now = Math.floor(Date.now() / 1000)
  db.transaction(() => {
    const update = db.prepare(`UPDATE social_credentials SET protected_blob = ?, protector_version = ?, updated_at = ?
      WHERE workspace_id = ? AND credential_ref = ?`).run(protectedBlob, protector.version, now, workspaceId, row.credential_ref)
    if (update.changes !== 1) throw new Error('Social account not found')
    db.prepare(`UPDATE social_accounts SET updated_at = ? WHERE workspace_id = ? AND account_id = ?`).run(now, workspaceId, accountId)
    audit(db, workspaceId, actor, 'social_credential_rotated', row.provider, accountId, row.status)
  })()
  return mapAccount(db.prepare(`SELECT account_id, provider, account_ref, external_account_id, account_mode, status,
    credential_ref, scopes, expires_at, refreshable, created_at, updated_at FROM social_accounts
    WHERE workspace_id = ? AND account_id = ?`).get(workspaceId, accountId))
}

export function deleteSocialAccount(db: Database.Database, workspaceId: number, actor: string, accountId: string): boolean {
  const row = db.prepare(`SELECT provider, status FROM social_accounts WHERE workspace_id = ? AND account_id = ?`)
    .get(workspaceId, accountId) as { provider: SocialProvider; status: SocialAccountStatus } | undefined
  if (!row) return false
  db.transaction(() => {
    db.prepare(`DELETE FROM social_accounts WHERE workspace_id = ? AND account_id = ?`).run(workspaceId, accountId)
    db.prepare(`DELETE FROM social_credentials WHERE workspace_id = ? AND credential_ref NOT IN
      (SELECT credential_ref FROM social_accounts WHERE workspace_id = ? AND credential_ref IS NOT NULL)`)
      .run(workspaceId, workspaceId)
    audit(db, workspaceId, actor, 'social_credential_deleted', row.provider, accountId, 'DISCONNECTED')
  })()
  return true
}
