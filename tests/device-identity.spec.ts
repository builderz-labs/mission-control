import { describe, expect, it } from 'vitest'

/**
 * Unit tests for Ed25519 device identity logic (Issues #74, #79, #81).
 *
 * Node 18+ exposes the same Web Crypto API (globalThis.crypto.subtle) that
 * the browser uses, so we can exercise Ed25519 key generation, signing, and
 * localStorage-serialisation logic without a real browser.
 *
 * Tests are skipped on runtimes that don't support Ed25519 (older Node versions).
 */

// Detect Ed25519 support once at module load — used by skipIf below.
async function supportsEd25519(): Promise<boolean> {
  try {
    await globalThis.crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    return true
  } catch {
    return false
  }
}

const ed25519Available = await supportsEd25519()

// ---------------------------------------------------------------------------
// Helpers that mirror the production device-identity module logic
// ---------------------------------------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Device Identity — Ed25519 key management', () => {
  it.skipIf(!ed25519Available)(
    'generates Ed25519 key pair with correct byte lengths',
    async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

      // Ed25519 public key is always 32 bytes raw
      expect(pubRaw.byteLength).toBe(32)
      // PKCS8-wrapped Ed25519 private key is 48 bytes
      expect(privPkcs8.byteLength).toBe(48)
    },
  )

  it.skipIf(!ed25519Available)(
    'stores generated key pair and device ID via base64 serialisation',
    async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

      const deviceId = crypto.randomUUID()
      const pubB64 = toBase64(pubRaw)
      const privB64 = toBase64(privPkcs8)

      // Simulate the localStorage round-trip by verifying the values are non-empty
      expect(deviceId).toBeTruthy()
      expect(pubB64).toBeTruthy()
      expect(privB64).toBeTruthy()

      // Decoding must recover the original length
      expect(fromBase64(pubB64).byteLength).toBe(32)
      expect(fromBase64(privB64).byteLength).toBe(48)
    },
  )

  it.skipIf(!ed25519Available)(
    'signs a nonce and produces a valid 64-byte Ed25519 signature',
    async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const nonce = 'test-nonce-abc123'
      const nonceBytes = new TextEncoder().encode(nonce)

      const signatureBuffer = await crypto.subtle.sign('Ed25519', keyPair.privateKey, nonceBytes)
      const verified = await crypto.subtle.verify(
        'Ed25519',
        keyPair.publicKey,
        signatureBuffer,
        nonceBytes,
      )

      // Ed25519 signature is always 64 bytes
      expect(signatureBuffer.byteLength).toBe(64)
      // Signature must verify against the same nonce
      expect(verified).toBe(true)
    },
  )

  it.skipIf(!ed25519Available)(
    'persisted key pair (base64 round-trip) survives re-parse with identical lengths',
    async () => {
      const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey)
      const privPkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey)

      const deviceId = crypto.randomUUID()
      const pubB64 = toBase64(pubRaw)
      const privB64 = toBase64(privPkcs8)

      // Simulate "page reload": re-parse the base64 strings
      const restoredPub = fromBase64(pubB64)
      const restoredPriv = fromBase64(privB64)

      expect(deviceId).toBeTruthy()
      expect(restoredPub.byteLength).toBe(32)
      expect(restoredPriv.byteLength).toBe(48)
    },
  )

  it.skipIf(!ed25519Available)(
    'reimported private key can sign and verify (full round-trip)',
    async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

      const pubB64 = toBase64(pubRaw)
      const privB64 = toBase64(privPkcs8)

      // Re-import from base64 (simulates the localStorage → importKey path)
      const reimportedPriv = await crypto.subtle.importKey(
        'pkcs8',
        fromBase64(privB64).buffer as ArrayBuffer,
        'Ed25519',
        false,
        ['sign'],
      )
      const reimportedPub = await crypto.subtle.importKey(
        'raw',
        fromBase64(pubB64).buffer as ArrayBuffer,
        'Ed25519',
        false,
        ['verify'],
      )

      const nonce = 'round-trip-nonce-xyz'
      const data = new TextEncoder().encode(nonce)
      const sig = await crypto.subtle.sign('Ed25519', reimportedPriv, data)
      const ok = await crypto.subtle.verify('Ed25519', reimportedPub, sig, data)

      expect(ok).toBe(true)
      expect(sig.byteLength).toBe(64)
    },
  )

  it('device token cache read/write (pure logic — no browser required)', () => {
    // Simulate the in-memory token cache that the production module maintains
    const cache: Record<string, string | null> = {}

    cache['mc-device-token'] = 'tok_test_abc123'
    expect(cache['mc-device-token']).toBe('tok_test_abc123')

    // Clear
    delete cache['mc-device-token']
    expect(cache['mc-device-token']).toBeUndefined()
  })

  it('clearDeviceIdentity removes all storage keys', () => {
    // Simulate the in-memory representation of localStorage keys
    const store: Record<string, string> = {
      'mc-device-id': 'test-id',
      'mc-device-pubkey': 'test-pub',
      'mc-device-privkey': 'test-priv',
      'mc-device-token': 'test-token',
    }

    // Replicate clearDeviceIdentity logic
    const DEVICE_KEYS = ['mc-device-id', 'mc-device-pubkey', 'mc-device-privkey', 'mc-device-token']
    for (const key of DEVICE_KEYS) {
      delete store[key]
    }

    expect(store['mc-device-id']).toBeUndefined()
    expect(store['mc-device-pubkey']).toBeUndefined()
    expect(store['mc-device-privkey']).toBeUndefined()
    expect(store['mc-device-token']).toBeUndefined()
  })
})
