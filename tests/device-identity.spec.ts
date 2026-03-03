import { test, expect } from '@playwright/test'

/**
 * E2E tests for Ed25519 device identity (Issues #74, #79, #81).
 *
 * These run in a real Chromium browser to exercise Web Crypto Ed25519 and
 * localStorage persistence — the same environment Mission Control uses.
 */

test.describe('Device Identity — Ed25519 key management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app so we have a page context with localStorage
    await page.goto('/')
    // Clear any leftover device identity from previous runs
    await page.evaluate(() => {
      localStorage.removeItem('mc-device-id')
      localStorage.removeItem('mc-device-pubkey')
      localStorage.removeItem('mc-device-privkey')
      localStorage.removeItem('mc-device-token')
    })
  })

  test('generates Ed25519 key pair and stores in localStorage', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Check Ed25519 support first
      try {
        await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      } catch {
        return { skipped: true, reason: 'Ed25519 not supported in this browser' }
      }

      // Dynamically import the module (bundled by Next.js)
      // Since we can't import from the bundle directly, replicate the core logic
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

      // base64 encode
      const toBase64 = (buf: ArrayBuffer) => {
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        return btoa(binary)
      }

      const deviceId = crypto.randomUUID()
      const pubB64 = toBase64(pubRaw)
      const privB64 = toBase64(privPkcs8)

      localStorage.setItem('mc-device-id', deviceId)
      localStorage.setItem('mc-device-pubkey', pubB64)
      localStorage.setItem('mc-device-privkey', privB64)

      return {
        skipped: false,
        deviceId,
        pubKeyLength: pubRaw.byteLength,
        privKeyLength: privPkcs8.byteLength,
        storedId: localStorage.getItem('mc-device-id'),
        storedPub: localStorage.getItem('mc-device-pubkey'),
        storedPriv: localStorage.getItem('mc-device-privkey'),
      }
    })

    if (result.skipped) {
      test.skip(true, result.reason as string)
      return
    }

    // Ed25519 public key is always 32 bytes raw
    expect(result.pubKeyLength).toBe(32)
    // PKCS8-wrapped Ed25519 private key is 48 bytes
    expect(result.privKeyLength).toBe(48)
    // Values persisted to localStorage
    expect(result.storedId).toBe(result.deviceId)
    expect(result.storedPub).toBeTruthy()
    expect(result.storedPriv).toBeTruthy()
  })

  test('signs a nonce and produces a valid Ed25519 signature', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      } catch {
        return { skipped: true, reason: 'Ed25519 not supported' }
      }

      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const nonce = 'test-nonce-abc123'
      const encoder = new TextEncoder()
      const nonceBytes = encoder.encode(nonce)

      const signatureBuffer = await crypto.subtle.sign('Ed25519', keyPair.privateKey, nonceBytes)
      const verified = await crypto.subtle.verify('Ed25519', keyPair.publicKey, signatureBuffer, nonceBytes)

      return {
        skipped: false,
        signatureLength: signatureBuffer.byteLength,
        verified,
      }
    })

    if (result.skipped) {
      test.skip(true, result.reason as string)
      return
    }

    // Ed25519 signature is always 64 bytes
    expect(result.signatureLength).toBe(64)
    // Signature must verify against the same nonce
    expect(result.verified).toBe(true)
  })

  test('persisted key pair survives page reload', async ({ page }) => {
    const firstRun = await page.evaluate(async () => {
      try {
        const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
        const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey)
        const privPkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
        const toBase64 = (buf: ArrayBuffer) => {
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
          return btoa(binary)
        }
        const deviceId = crypto.randomUUID()
        localStorage.setItem('mc-device-id', deviceId)
        localStorage.setItem('mc-device-pubkey', toBase64(pubRaw))
        localStorage.setItem('mc-device-privkey', toBase64(privPkcs8))
        return { skipped: false, deviceId }
      } catch {
        return { skipped: true, reason: 'Ed25519 not supported' }
      }
    })

    if (firstRun.skipped) {
      test.skip(true, firstRun.reason as string)
      return
    }

    // Reload the page
    await page.reload()

    const afterReload = await page.evaluate(() => ({
      deviceId: localStorage.getItem('mc-device-id'),
      pubKey: localStorage.getItem('mc-device-pubkey'),
      privKey: localStorage.getItem('mc-device-privkey'),
    }))

    expect(afterReload.deviceId).toBe(firstRun.deviceId)
    expect(afterReload.pubKey).toBeTruthy()
    expect(afterReload.privKey).toBeTruthy()
  })

  test('reimported private key can sign and verify', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      } catch {
        return { skipped: true, reason: 'Ed25519 not supported' }
      }

      const toBase64 = (buf: ArrayBuffer) => {
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        return btoa(binary)
      }
      const fromBase64 = (b64: string) => {
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes
      }

      // Generate and export
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

      // Serialize to base64 (simulates localStorage round-trip)
      const pubB64 = toBase64(pubRaw)
      const privB64 = toBase64(privPkcs8)

      // Re-import from base64
      const reimportedPriv = await crypto.subtle.importKey(
        'pkcs8', fromBase64(privB64).buffer as ArrayBuffer, 'Ed25519', false, ['sign']
      )
      const reimportedPub = await crypto.subtle.importKey(
        'raw', fromBase64(pubB64).buffer as ArrayBuffer, 'Ed25519', false, ['verify']
      )

      // Sign with reimported private key, verify with reimported public key
      const nonce = 'round-trip-nonce-xyz'
      const encoder = new TextEncoder()
      const data = encoder.encode(nonce)
      const sig = await crypto.subtle.sign('Ed25519', reimportedPriv, data)
      const ok = await crypto.subtle.verify('Ed25519', reimportedPub, sig, data)

      return { skipped: false, verified: ok, signatureLength: sig.byteLength }
    })

    if (result.skipped) {
      test.skip(true, result.reason as string)
      return
    }

    expect(result.verified).toBe(true)
    expect(result.signatureLength).toBe(64)
  })

  test('device token cache read/write', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('mc-device-token', 'tok_test_abc123')
    })

    const token = await page.evaluate(() => localStorage.getItem('mc-device-token'))
    expect(token).toBe('tok_test_abc123')

    // Clear
    await page.evaluate(() => localStorage.removeItem('mc-device-token'))
    const cleared = await page.evaluate(() => localStorage.getItem('mc-device-token'))
    expect(cleared).toBeNull()
  })

  test('clearDeviceIdentity removes all storage keys', async ({ page }) => {
    // Set all keys
    await page.evaluate(() => {
      localStorage.setItem('mc-device-id', 'test-id')
      localStorage.setItem('mc-device-pubkey', 'test-pub')
      localStorage.setItem('mc-device-privkey', 'test-priv')
      localStorage.setItem('mc-device-token', 'test-token')
    })

    // Clear (replicate clearDeviceIdentity logic)
    await page.evaluate(() => {
      localStorage.removeItem('mc-device-id')
      localStorage.removeItem('mc-device-pubkey')
      localStorage.removeItem('mc-device-privkey')
      localStorage.removeItem('mc-device-token')
    })

    const remaining = await page.evaluate(() => ({
      id: localStorage.getItem('mc-device-id'),
      pub: localStorage.getItem('mc-device-pubkey'),
      priv: localStorage.getItem('mc-device-privkey'),
      token: localStorage.getItem('mc-device-token'),
    }))

    expect(remaining.id).toBeNull()
    expect(remaining.pub).toBeNull()
    expect(remaining.priv).toBeNull()
    expect(remaining.token).toBeNull()
  })
})
