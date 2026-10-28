import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'
import {
  deleteSocialAccount,
  getSocialCredential,
  getSocialSecretProtector,
  InMemorySecretProtector,
  listSocialAccounts,
  putSocialAccount,
  rotateSocialCredential,
  type SecretProtector,
} from '../social-credential-vault'

let db: Database.Database
let protector: InMemorySecretProtector

const makeInput = (accessToken = 'access-token-secret-123') => ({
  provider: 'instagram' as const,
  account_ref: '@sample',
  external_account_id: 'ig-100',
  status: 'CONNECTED' as const,
  scopes: ['profile', 'insights'],
  credential: { access_token: accessToken, refresh_token: 'refresh-token-secret-456' },
})

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  protector = new InMemorySecretProtector()
})
afterEach(() => db.close())

describe('social credential vault', () => {
  it('persists only protected material and keeps the account registry secret free', () => {
    const secret = 'access-token-secret-123'
    const account = putSocialAccount(db, 1, 'admin', makeInput(secret), protector)
    const persisted = db.prepare('SELECT protected_blob FROM social_credentials WHERE workspace_id = 1').get() as { protected_blob: string }
    const accountRow = JSON.stringify(db.prepare('SELECT * FROM social_accounts').get())
    expect(persisted.protected_blob).not.toContain(secret)
    expect(accountRow).not.toContain(secret)
    expect(JSON.stringify(db.prepare('SELECT detail FROM audit_log').all())).not.toMatch(/access-token-secret|refresh-token-secret/i)
    expect(account.credential_ref).toMatch(/^[0-9a-f-]{36}$/i)
    expect(account.nonsecret_metadata).toEqual({})
  })

  it('lists metadata only and isolates credential retrieval by workspace', () => {
    const account = putSocialAccount(db, 1, 'admin', makeInput(), protector)
    expect(JSON.stringify(listSocialAccounts(db, 1))).not.toMatch(/access_token|refresh_token|access-token-secret|refresh-token-secret/i)
    expect(() => getSocialCredential(db, 2, account.credential_ref!, protector)).toThrow('Social credential not found')
  })

  it('rotates protected material and retrieves only the new payload server side', () => {
    const account = putSocialAccount(db, 1, 'admin', makeInput(), protector)
    const oldBlob = (db.prepare('SELECT protected_blob FROM social_credentials').get() as { protected_blob: string }).protected_blob
    rotateSocialCredential(db, 1, 'admin', account.account_id, { access_token: 'rotated-token-secret-789' }, protector)
    const newBlob = (db.prepare('SELECT protected_blob FROM social_credentials').get() as { protected_blob: string }).protected_blob
    expect(newBlob).not.toBe(oldBlob)
    expect(getSocialCredential(db, 1, account.credential_ref!, protector)).toEqual({ access_token: 'rotated-token-secret-789' })
  })

  it('deletes account and credential material together', () => {
    const account = putSocialAccount(db, 1, 'admin', makeInput(), protector)
    expect(deleteSocialAccount(db, 1, 'admin', account.account_id)).toBe(true)
    expect(db.prepare('SELECT count(*) AS count FROM social_credentials').get()).toEqual({ count: 0 })
    expect(() => getSocialCredential(db, 1, account.credential_ref!, protector)).toThrow('Social credential not found')
  })

  it('fails closed when protection is unsupported and does not leak input in errors', () => {
    const unsupported: SecretProtector = {
      version: 'unsupported',
      protect: () => { throw new Error('raw provider token') },
      unprotect: () => { throw new Error('raw provider token') },
    }
    let errorMessage = ''
    try { putSocialAccount(db, 1, 'admin', makeInput('raw provider token'), unsupported) }
    catch (error) { errorMessage = (error as Error).message }
    expect(errorMessage).toBe('Unable to protect social credential')
    expect(errorMessage).not.toContain('raw provider token')
    expect(() => putSocialAccount(db, 1, 'admin', {
      ...makeInput(), account_ref: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789',
    }, protector)).toThrow('Invalid social account metadata')
    const original = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    try { expect(() => getSocialSecretProtector()).toThrow('Social credential protection is unavailable') }
    finally { Object.defineProperty(process, 'platform', { configurable: true, value: original }) }
    expect(db.prepare('SELECT count(*) AS count FROM social_credentials').get()).toEqual({ count: 0 })
  })

  it('keeps migration 061 idempotent and preserves existing database content', () => {
    db.exec("CREATE TABLE retained_content (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO retained_content VALUES (1, 'keep-me')")
    runMigrations(db)
    expect(db.prepare('SELECT value FROM retained_content WHERE id = 1').get()).toEqual({ value: 'keep-me' })
    expect(db.prepare("SELECT count(*) AS count FROM schema_migrations WHERE id = '061_social_credential_vault'").get()).toEqual({ count: 1 })
  })
})

const apiState = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/db', () => ({ getDatabase: () => apiState.db }))
vi.mock('@/lib/auth', () => ({ requireRole: () => ({ user: { username: 'admin', workspace_id: 1 } }) }))

describe('social account status API', () => {
  it('never returns credentials or protected blobs', async () => {
    apiState.db = db
    putSocialAccount(db, 1, 'admin', makeInput(), protector)
    const { GET } = await import('../../app/api/marketing/social-accounts/route')
    const response = await GET(new NextRequest('http://localhost/api/marketing/social-accounts'))
    const json = await response.json()
    expect(JSON.stringify(json)).not.toMatch(/access_token|refresh_token|access-token-secret|refresh-token-secret|protected_blob/i)
    apiState.db = null
  })
})
