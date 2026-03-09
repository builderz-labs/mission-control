import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'

const KEYS_FILE = path.join(config.dataDir, 'server-device-identity.json')

interface StoredKeys {
  deviceId: string
  publicKeyBase64: string
  privateKeyPkcs8Base64: string
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url')
}

function getOrCreateKeys(): StoredKeys {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'))
    }
  } catch {
    // Corrupted file — regenerate
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

  // Export raw 32-byte public key from SPKI wrapper
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const rawPub = (spki as Buffer).subarray(spki.length - 32)

  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' })

  const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex')
  const publicKeyBase64 = toBase64Url(rawPub)
  const privateKeyPkcs8Base64 = toBase64Url(pkcs8 as Buffer)

  const stored: StoredKeys = { deviceId, publicKeyBase64, privateKeyPkcs8Base64 }
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.writeFileSync(KEYS_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 })

  return stored
}

/**
 * POST /api/auth/device-identity
 *
 * Server-side Ed25519 device identity signing for non-secure browser contexts.
 * When the browser lacks crypto.subtle (HTTP + non-localhost), the client
 * delegates device-identity signing to this endpoint which uses Node.js crypto.
 */
export async function POST(request: Request) {
  const body = await request.json()
  const { nonce, clientId, clientMode, role, scopes, token } = body

  if (!nonce) {
    return NextResponse.json({ error: 'nonce is required' }, { status: 400 })
  }

  const keys = getOrCreateKeys()
  const signedAt = Date.now()

  const payload = [
    'v2',
    keys.deviceId,
    clientId || 'control-ui',
    clientMode || 'ui',
    role || 'operator',
    (scopes || ['operator.admin']).join(','),
    String(signedAt),
    token || '',
    nonce,
  ].join('|')

  const privKeyDer = Buffer.from(keys.privateKeyPkcs8Base64, 'base64url')
  const privateKey = crypto.createPrivateKey({ key: privKeyDer, format: 'der', type: 'pkcs8' })
  const signature = crypto.sign(null, Buffer.from(payload), privateKey)

  return NextResponse.json({
    deviceId: keys.deviceId,
    publicKeyBase64: keys.publicKeyBase64,
    signature: toBase64Url(signature),
    signedAt,
    nonce,
  })
}
