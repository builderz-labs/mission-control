'use client'

import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('DeviceIdentity')

/**
 * Ed25519 device identity for OpenClaw gateway protocol v3 challenge-response.
 *
 * v2 storage model (fixes #574):
 *   - Private key generated as a non-extractable WebCrypto CryptoKey and
 *     persisted in IndexedDB. The raw key bytes are never exportable from JS,
 *     so an XSS that gets script execution still cannot exfiltrate the key.
 *   - Device ID + public key remain in localStorage (both are public anyway).
 *   - A version flag (`mc-key-version`) lets us migrate v1 → v2 transparently.
 *
 * v1 fallback (preserved for resilience):
 *   - Older browsers without IndexedDB or in restrictive private-mode contexts
 *     fall back to the original localStorage path. The fallback is marked
 *     in-memory so callers can inform the user. This matches the original
 *     "auth-token-only mode" graceful degradation contract.
 */

// localStorage keys
const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY_V1 = 'mc-device-privkey'      // legacy v1 plaintext PKCS8 (migrated away)
const STORAGE_KEY_VERSION = 'mc-key-version'         // '2' = IndexedDB CryptoKey
const STORAGE_DEVICE_TOKEN = 'mc-device-token'
const STORAGE_GATEWAY_URL = 'mc-gateway-url'

const CURRENT_KEY_VERSION = '2'

// IndexedDB
const DB_NAME = 'mc-device-identity'
const DB_VERSION = 1
const KEY_STORE = 'keys'
const PRIVATE_KEY_NAME = 'private-key'

export { STORAGE_GATEWAY_URL }

export interface DeviceIdentity {
  deviceId: string
  publicKeyBase64: string
  privateKey: CryptoKey
  /**
   * Storage backend in use:
   *   - 'indexeddb-cryptokey' = v2, non-extractable IndexedDB CryptoKey (preferred)
   *   - 'localstorage-fallback' = v1, plaintext localStorage (only when IndexedDB
   *     is unavailable, e.g. some private-mode browsers)
   */
  storageMode: 'indexeddb-cryptokey' | 'localstorage-fallback'
}

// ── Helpers ──────────────────────────────────────────────────────

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  const bytes = new Uint8Array(digest)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── IndexedDB primitives ─────────────────────────────────────────

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE)
      }
    }
  })
}

async function idbPutKey(name: string, key: CryptoKey): Promise<void> {
  const db = await openKeyDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite')
    const store = tx.objectStore(KEY_STORE)
    const req = store.put(key, name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
    tx.oncomplete = () => db.close()
    tx.onerror = () => db.close()
  })
}

async function idbGetKey(name: string): Promise<CryptoKey | null> {
  const db = await openKeyDb()
  return new Promise<CryptoKey | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readonly')
    const store = tx.objectStore(KEY_STORE)
    const req = store.get(name)
    req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
    tx.oncomplete = () => db.close()
    tx.onerror = () => db.close()
  })
}

async function idbDeleteKey(name: string): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await openKeyDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite')
      const store = tx.objectStore(KEY_STORE)
      const req = store.delete(name)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      tx.oncomplete = () => db.close()
      tx.onerror = () => db.close()
    })
  } catch {
    // Best effort.
  }
}

// ── Key management ───────────────────────────────────────────────

async function importLegacyPrivateKey(pkcs8Bytes: Uint8Array, extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pkcs8Bytes as unknown as BufferSource, 'Ed25519', extractable, ['sign'])
}

/**
 * Migrate a v1 plaintext-localStorage key into IndexedDB as a non-extractable
 * CryptoKey. After successful migration the v1 key is removed from
 * localStorage so the plaintext copy doesn't linger.
 *
 * Returns the migrated identity, or null if there was no v1 key to migrate.
 */
async function migrateV1ToV2(): Promise<DeviceIdentity | null> {
  if (!isIndexedDbAvailable()) return null

  const storedPriv = localStorage.getItem(STORAGE_PRIVKEY_V1)
  if (!storedPriv) return null

  // Already migrated? Idempotent.
  if (localStorage.getItem(STORAGE_KEY_VERSION) === CURRENT_KEY_VERSION) return null

  const storedId = localStorage.getItem(STORAGE_DEVICE_ID)
  const storedPub = localStorage.getItem(STORAGE_PUBKEY)
  if (!storedId || !storedPub) return null

  try {
    // Re-import the v1 PKCS8 bytes as a non-extractable CryptoKey, then
    // persist it into IndexedDB.
    const privateKey = await importLegacyPrivateKey(fromBase64Url(storedPriv), false)
    await idbPutKey(PRIVATE_KEY_NAME, privateKey)
    localStorage.setItem(STORAGE_KEY_VERSION, CURRENT_KEY_VERSION)
    localStorage.removeItem(STORAGE_PRIVKEY_V1)
    log.info('Device identity migrated from localStorage v1 to IndexedDB v2')
    return {
      deviceId: storedId,
      publicKeyBase64: storedPub,
      privateKey,
      storageMode: 'indexeddb-cryptokey',
    }
  } catch (err) {
    log.warn('Device identity v1→v2 migration failed; will regenerate', { errorMessage: (err as Error)?.message })
    return null
  }
}

/**
 * Generate a new identity.
 *
 * Tries to use the secure path (non-extractable CryptoKey + IndexedDB).
 * If IndexedDB is unavailable (private mode, hostile browser), falls back
 * to the v1 storage shape — same as before this PR — so the gateway
 * handshake still works.
 */
async function createNewIdentity(): Promise<DeviceIdentity> {
  // Attempt v2 (non-extractable, IndexedDB-backed) path.
  if (isIndexedDbAvailable()) {
    try {
      const keyPair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])
      const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const deviceId = await sha256Hex(pubRaw)
      const publicKeyBase64 = toBase64Url(pubRaw)

      await idbPutKey(PRIVATE_KEY_NAME, keyPair.privateKey)
      localStorage.setItem(STORAGE_DEVICE_ID, deviceId)
      localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)
      localStorage.setItem(STORAGE_KEY_VERSION, CURRENT_KEY_VERSION)
      // Defensive: clear any v1 plaintext that may exist from a partial migration.
      localStorage.removeItem(STORAGE_PRIVKEY_V1)

      return { deviceId, publicKeyBase64, privateKey: keyPair.privateKey, storageMode: 'indexeddb-cryptokey' }
    } catch (err) {
      log.warn('IndexedDB-backed key generation failed, falling back to v1 storage', { errorMessage: (err as Error)?.message })
      // Fall through to v1 fallback.
    }
  }

  // v1 fallback — extractable key in plaintext localStorage. Keeps the
  // gateway handshake working when IndexedDB isn't available.
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const deviceId = await sha256Hex(pubRaw)
  const publicKeyBase64 = toBase64Url(pubRaw)
  const privateKeyBase64 = toBase64Url(privPkcs8)

  localStorage.setItem(STORAGE_DEVICE_ID, deviceId)
  localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)
  localStorage.setItem(STORAGE_PRIVKEY_V1, privateKeyBase64)
  // Do NOT set STORAGE_KEY_VERSION in fallback mode — the next page load
  // may have IndexedDB available and will trigger a v1→v2 migration.

  return { deviceId, publicKeyBase64, privateKey: keyPair.privateKey, storageMode: 'localstorage-fallback' }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Returns existing device identity or generates a new one.
 *
 * Lookup order:
 *   1. v2 (IndexedDB CryptoKey) — preferred, non-extractable.
 *   2. v1→v2 migration if a legacy plaintext key is present.
 *   3. v1 (plaintext localStorage) — only when IndexedDB is unavailable.
 *   4. Generate a new identity.
 */
export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const storedId = localStorage.getItem(STORAGE_DEVICE_ID)
  const storedPub = localStorage.getItem(STORAGE_PUBKEY)
  const keyVersion = localStorage.getItem(STORAGE_KEY_VERSION)

  // Attempt 1: v2 IndexedDB-backed key
  if (storedId && storedPub && keyVersion === CURRENT_KEY_VERSION && isIndexedDbAvailable()) {
    try {
      const privateKey = await idbGetKey(PRIVATE_KEY_NAME)
      if (privateKey) {
        return { deviceId: storedId, publicKeyBase64: storedPub, privateKey, storageMode: 'indexeddb-cryptokey' }
      }
      // Marked v2 but key missing — treat as corruption, fall through.
      log.warn('v2 key version flag set but no IndexedDB key found; regenerating')
    } catch (err) {
      log.warn('IndexedDB read failed; will attempt migration or regenerate', { errorMessage: (err as Error)?.message })
    }
  }

  // Attempt 2: migrate v1 → v2 if legacy plaintext key is present
  const migrated = await migrateV1ToV2()
  if (migrated) return migrated

  // Attempt 3: v1 plaintext fallback (only if IndexedDB is unavailable)
  if (!isIndexedDbAvailable()) {
    const storedPriv = localStorage.getItem(STORAGE_PRIVKEY_V1)
    if (storedId && storedPub && storedPriv) {
      try {
        const privateKey = await importLegacyPrivateKey(fromBase64Url(storedPriv), false)
        return { deviceId: storedId, publicKeyBase64: storedPub, privateKey, storageMode: 'localstorage-fallback' }
      } catch {
        log.warn('v1 plaintext key corrupted; regenerating')
      }
    }
  }

  // Attempt 4: generate fresh identity
  return createNewIdentity()
}

/**
 * Signs an auth payload with the Ed25519 private key.
 * Returns base64url signature and signing timestamp.
 */
export async function signPayload(
  privateKey: CryptoKey,
  payload: string,
  signedAt = Date.now()
): Promise<{ signature: string; signedAt: number }> {
  const encoder = new TextEncoder()
  const payloadBytes = encoder.encode(payload)
  const signatureBuffer = await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)
  return {
    signature: toBase64Url(signatureBuffer),
    signedAt,
  }
}

/** Reads cached device token from localStorage (returned by gateway on successful connect). */
export function getCachedDeviceToken(): string | null {
  return localStorage.getItem(STORAGE_DEVICE_TOKEN)
}

/** Caches the device token returned by the gateway after successful connect. */
export function cacheDeviceToken(token: string): void {
  localStorage.setItem(STORAGE_DEVICE_TOKEN, token)
}

/**
 * Removes all device identity data (localStorage + IndexedDB) for troubleshooting.
 *
 * The IndexedDB delete is fire-and-forget so callers in synchronous code paths
 * (e.g. WebSocket onmessage handlers) keep their existing call shape. Errors
 * are swallowed inside `idbDeleteKey`.
 */
export function clearDeviceIdentity(): void {
  localStorage.removeItem(STORAGE_DEVICE_ID)
  localStorage.removeItem(STORAGE_PUBKEY)
  localStorage.removeItem(STORAGE_PRIVKEY_V1)
  localStorage.removeItem(STORAGE_KEY_VERSION)
  localStorage.removeItem(STORAGE_DEVICE_TOKEN)
  void idbDeleteKey(PRIVATE_KEY_NAME)
}

/** True when the device is using the secure (v2) storage backend. */
export function isSecureKeyStorage(): boolean {
  return localStorage.getItem(STORAGE_KEY_VERSION) === CURRENT_KEY_VERSION
}
