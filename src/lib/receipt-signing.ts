/**
 * Ed25519 receipt signing for MCP tool call audit records.
 *
 * Uses Node.js 22+ native crypto (no external dependencies).
 * Each audit record gets a cryptographic receipt: SHA-256 content hash
 * + Ed25519 signature. Verification recomputes the hash and checks
 * the signature — if the record was modified after signing, the hash
 * won't match.
 *
 * Key management: auto-generates on first use, persists in the settings table.
 */

import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto'
import { getDatabase } from '@/lib/db'

interface ReceiptKeyPair {
  publicKey: string  // base64-encoded
  privateKey: string // base64-encoded
}

interface Receipt {
  payloadHash: string // hex SHA-256 of canonical payload
  signature: string   // hex Ed25519 signature
  publicKey: string   // base64-encoded public key
}

/**
 * Deterministic JSON serialisation (sorted keys) for consistent hashing.
 */
function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(value as object).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k]
      }
      return sorted
    }
    return value
  })
}

/**
 * Get or create the Ed25519 signing keypair.
 * Stored in the settings table as 'receipt_signing_public_key' and
 * 'receipt_signing_private_key'. Generated once on first use.
 */
export function getOrCreateSigningKey(): ReceiptKeyPair {
  const db = getDatabase()

  const existing = db.prepare(
    "SELECT value FROM settings WHERE key = 'receipt_signing_private_key'"
  ).get() as { value: string } | undefined

  if (existing) {
    const pub = db.prepare(
      "SELECT value FROM settings WHERE key = 'receipt_signing_public_key'"
    ).get() as { value: string } | undefined

    return {
      privateKey: existing.value,
      publicKey: pub?.value ?? '',
    }
  }

  // Generate new Ed25519 keypair
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  })

  const pubB64 = publicKey.toString('base64')
  const privB64 = privateKey.toString('base64')

  // Persist in settings (upsert)
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('receipt_signing_public_key', ?)"
  ).run(pubB64)
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('receipt_signing_private_key', ?)"
  ).run(privB64)

  return { publicKey: pubB64, privateKey: privB64 }
}

/**
 * Sign an MCP audit record, producing a tamper-evident receipt.
 *
 * The payload is canonicalized (sorted keys), hashed with SHA-256,
 * then signed with Ed25519. The receipt includes the hash, signature,
 * and public key — everything needed for offline verification.
 */
export function signAuditRecord(payload: Record<string, unknown>): Receipt {
  const keys = getOrCreateSigningKey()

  const canonical = canonicalize(payload)
  const hash = createHash('sha256').update(canonical).digest('hex')

  const privateKeyDer = Buffer.from(keys.privateKey, 'base64')
  const privateKeyObj = {
    key: privateKeyDer,
    format: 'der' as const,
    type: 'pkcs8' as const,
  }

  const sig = sign(null, Buffer.from(canonical), privateKeyObj)

  return {
    payloadHash: hash,
    signature: sig.toString('hex'),
    publicKey: keys.publicKey,
  }
}

/**
 * Verify an audit record's receipt.
 *
 * Recomputes the canonical hash and checks the Ed25519 signature.
 * Returns true if the record has not been tampered with.
 */
export function verifyAuditRecord(
  payload: Record<string, unknown>,
  signature: string,
  publicKeyB64: string
): boolean {
  try {
    const canonical = canonicalize(payload)

    const publicKeyDer = Buffer.from(publicKeyB64, 'base64')
    const publicKeyObj = {
      key: publicKeyDer,
      format: 'der' as const,
      type: 'spki' as const,
    }

    const sigBuffer = Buffer.from(signature, 'hex')
    return verify(null, Buffer.from(canonical), publicKeyObj, sigBuffer)
  } catch {
    return false
  }
}

/**
 * Get the public key for external verifiers.
 */
export function getPublicKey(): string {
  return getOrCreateSigningKey().publicKey
}
