import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheDeviceToken,
  clearDeviceIdentity,
  getCachedDeviceToken,
  getOrCreateDeviceIdentity,
  signPayload,
} from '@/lib/device-identity'

const privateKey = { type: 'private' } as CryptoKey
const publicKey = { type: 'public' } as CryptoKey

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, String(value))
    }),
  }
}

describe('device identity', () => {
  let originalCrypto: Crypto | undefined
  let originalLocalStorage: Storage | undefined

  beforeEach(() => {
    originalCrypto = globalThis.crypto
    originalLocalStorage = globalThis.localStorage

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorage(),
    })

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        subtle: {
          generateKey: vi.fn().mockResolvedValue({ privateKey, publicKey }),
          exportKey: vi.fn(async (format: string) => {
            if (format === 'raw') return bytes(Array.from({ length: 32 }, (_, index) => index + 1))
            return bytes(Array.from({ length: 48 }, (_, index) => index + 33))
          }),
          digest: vi.fn().mockResolvedValue(bytes(Array.from({ length: 32 }, (_, index) => 255 - index))),
          importKey: vi.fn().mockResolvedValue(privateKey),
          sign: vi.fn().mockResolvedValue(bytes(Array.from({ length: 64 }, (_, index) => index))),
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    })
  })

  it('creates and stores a new Ed25519 identity when none exists', async () => {
    const identity = await getOrCreateDeviceIdentity()

    expect(identity.deviceId).toBe('fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0')
    expect(identity.publicKeyBase64).toBe('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA')
    expect(identity.privateKey).toBe(privateKey)
    expect(localStorage.getItem('mc-device-id')).toBe(identity.deviceId)
    expect(localStorage.getItem('mc-device-pubkey')).toBe(identity.publicKeyBase64)
    expect(localStorage.getItem('mc-device-privkey')).toBeTruthy()
  })

  it('reuses a stored identity by importing the private key', async () => {
    await getOrCreateDeviceIdentity()
    const generatedId = localStorage.getItem('mc-device-id')
    const generatedPub = localStorage.getItem('mc-device-pubkey')

    const identity = await getOrCreateDeviceIdentity()

    expect(identity.deviceId).toBe(generatedId)
    expect(identity.publicKeyBase64).toBe(generatedPub)
    expect(crypto.subtle.generateKey).toHaveBeenCalledTimes(1)
    expect(crypto.subtle.importKey).toHaveBeenCalledTimes(1)
  })

  it('regenerates corrupted stored key material', async () => {
    localStorage.setItem('mc-device-id', 'stored-id')
    localStorage.setItem('mc-device-pubkey', 'stored-pub')
    localStorage.setItem('mc-device-privkey', 'not-valid-base64url')
    vi.mocked(crypto.subtle.importKey).mockRejectedValueOnce(new Error('bad key'))

    const identity = await getOrCreateDeviceIdentity()

    expect(identity.deviceId).not.toBe('stored-id')
    expect(crypto.subtle.generateKey).toHaveBeenCalledTimes(1)
  })

  it('signs payloads and returns base64url signatures', async () => {
    const result = await signPayload(privateKey, 'nonce', 1234)

    expect(result).toEqual({
      signature: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-Pw',
      signedAt: 1234,
    })
    expect(crypto.subtle.sign).toHaveBeenCalledWith('Ed25519', privateKey, new TextEncoder().encode('nonce'))
  })

  it('caches and clears device token state', () => {
    cacheDeviceToken('tok_test_abc123')
    expect(getCachedDeviceToken()).toBe('tok_test_abc123')

    localStorage.setItem('mc-device-id', 'device')
    localStorage.setItem('mc-device-pubkey', 'pub')
    localStorage.setItem('mc-device-privkey', 'priv')
    clearDeviceIdentity()

    expect(getCachedDeviceToken()).toBeNull()
    expect(localStorage.getItem('mc-device-id')).toBeNull()
    expect(localStorage.getItem('mc-device-pubkey')).toBeNull()
    expect(localStorage.getItem('mc-device-privkey')).toBeNull()
  })
})
