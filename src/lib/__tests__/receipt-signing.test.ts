import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the database
const mockGet = vi.fn()
const mockRun = vi.fn()
const mockPrepare = vi.fn(() => ({ get: mockGet, run: mockRun }))
const mockExec = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: mockPrepare,
    exec: mockExec,
  }),
}))

import {
  signAuditRecord,
  verifyAuditRecord,
  getOrCreateSigningKey,
} from '@/lib/receipt-signing'

describe('receipt-signing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate no existing key (first-use scenario)
    mockGet.mockReturnValue(undefined)
  })

  describe('getOrCreateSigningKey', () => {
    it('generates a new keypair when none exists', () => {
      const keys = getOrCreateSigningKey()
      expect(keys.publicKey).toBeTruthy()
      expect(keys.privateKey).toBeTruthy()
      expect(typeof keys.publicKey).toBe('string')
      expect(typeof keys.privateKey).toBe('string')
      // Should persist the keys
      expect(mockRun).toHaveBeenCalledTimes(2)
    })

    it('returns existing keypair when one exists', () => {
      const fakePriv = 'existingPrivateKey=='
      const fakePub = 'existingPublicKey=='
      mockGet
        .mockReturnValueOnce({ value: fakePriv }) // private key lookup
        .mockReturnValueOnce({ value: fakePub })   // public key lookup

      const keys = getOrCreateSigningKey()
      expect(keys.privateKey).toBe(fakePriv)
      expect(keys.publicKey).toBe(fakePub)
      // Should NOT persist new keys
      expect(mockRun).not.toHaveBeenCalled()
    })
  })

  describe('signAuditRecord', () => {
    it('produces a receipt with hash, signature, and public key', () => {
      const payload = {
        tool_name: 'read_file',
        agent_name: 'test-agent',
        success: 1,
        created_at: 1712345678,
      }

      const receipt = signAuditRecord(payload)

      expect(receipt.payloadHash).toBeTruthy()
      expect(receipt.payloadHash).toHaveLength(64) // SHA-256 hex
      expect(receipt.signature).toBeTruthy()
      expect(receipt.publicKey).toBeTruthy()
    })

    it('produces consistent hashes for the same payload', () => {
      const payload = { tool_name: 'test', success: 1, created_at: 1000 }

      const r1 = signAuditRecord(payload)
      const r2 = signAuditRecord(payload)

      expect(r1.payloadHash).toBe(r2.payloadHash)
    })

    it('produces different hashes for different payloads', () => {
      const r1 = signAuditRecord({ tool_name: 'a', created_at: 1 })
      const r2 = signAuditRecord({ tool_name: 'b', created_at: 1 })

      expect(r1.payloadHash).not.toBe(r2.payloadHash)
    })
  })

  describe('verifyAuditRecord', () => {
    it('verifies a freshly signed record', () => {
      const payload = {
        tool_name: 'write_file',
        agent_name: 'agent-1',
        success: 1,
        created_at: 1712345678,
      }

      const receipt = signAuditRecord(payload)
      const valid = verifyAuditRecord(payload, receipt.signature, receipt.publicKey)

      expect(valid).toBe(true)
    })

    it('rejects a tampered record', () => {
      const payload = {
        tool_name: 'delete_resource',
        success: 0,
        created_at: 1712345678,
      }

      const receipt = signAuditRecord(payload)

      // Tamper with the payload
      const tampered = { ...payload, success: 1 }
      const valid = verifyAuditRecord(tampered, receipt.signature, receipt.publicKey)

      expect(valid).toBe(false)
    })

    it('rejects an invalid signature', () => {
      const payload = { tool_name: 'test', created_at: 1 }
      const receipt = signAuditRecord(payload)

      // Corrupt the signature
      const badSig = receipt.signature.slice(0, -2) + 'ff'
      const valid = verifyAuditRecord(payload, badSig, receipt.publicKey)

      expect(valid).toBe(false)
    })

    it('returns false for malformed inputs', () => {
      expect(verifyAuditRecord({}, 'not-hex', 'not-base64')).toBe(false)
    })
  })

  describe('canonicalization', () => {
    it('produces the same hash regardless of key insertion order', () => {
      const a = { z: 1, a: 2, m: 3 }
      const b = { a: 2, m: 3, z: 1 }

      const ra = signAuditRecord(a)
      const rb = signAuditRecord(b)

      expect(ra.payloadHash).toBe(rb.payloadHash)
    })
  })
})
