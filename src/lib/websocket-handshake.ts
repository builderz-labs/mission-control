'use client'

// ---------------------------------------------------------------------------
// WebSocket — connect handshake payload builder
// ---------------------------------------------------------------------------
import {
  getOrCreateDeviceIdentity,
  signPayload,
  getCachedDeviceToken,
} from '@/lib/device-identity'
import { APP_VERSION } from '@/lib/version'
import { PROTOCOL_VERSION, DEFAULT_GATEWAY_CLIENT_ID } from './websocket-types'

interface BuildConnectRequestOptions {
  readonly nonce?: string
  readonly authToken: string
  readonly tokenOnlyFallback: boolean
  readonly requestId: string
}

/**
 * Build the gateway `connect` RPC request object.
 * Performs async Ed25519 signing when a nonce is present and device identity
 * is available. Falls back gracefully when WebCrypto is unavailable.
 * Returns a plain object ready to pass to `JSON.stringify` + `ws.send`.
 */
export async function buildConnectRequest(options: BuildConnectRequestOptions): Promise<object> {
  const { nonce, authToken, tokenOnlyFallback, requestId } = options
  const cachedToken = getCachedDeviceToken()

  const clientId = DEFAULT_GATEWAY_CLIENT_ID
  const clientMode = 'ui'
  const role = 'operator'
  const scopes = ['operator.admin']
  const tokenForSignature = authToken ?? cachedToken ?? ''

  let device: {
    id: string
    publicKey: string
    signature: string
    signedAt: number
    nonce: string
  } | undefined

  if (nonce && !tokenOnlyFallback) {
    try {
      const identity = await getOrCreateDeviceIdentity()
      const signedAt = Date.now()
      // Sign OpenClaw v2 device-auth payload (gateway accepts v2 and v3).
      const payload = [
        'v2',
        identity.deviceId,
        clientId,
        clientMode,
        role,
        scopes.join(','),
        String(signedAt),
        tokenForSignature,
        nonce,
      ].join('|')
      const { signature } = await signPayload(identity.privateKey, payload, signedAt)
      device = {
        id: identity.deviceId,
        publicKey: identity.publicKeyBase64,
        signature,
        signedAt,
        nonce,
      }
    } catch {
      // Device identity unavailable — proceed without it
    }
  }

  return {
    type: 'req',
    method: 'connect',
    id: requestId,
    params: {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: clientId,
        displayName: 'Ultron Mission Control',
        version: APP_VERSION,
        platform: 'web',
        mode: clientMode,
        instanceId: `mc-${Date.now()}`,
      },
      role,
      scopes,
      caps: ['tool-events'],
      auth: authToken ? { token: authToken } : undefined,
      device,
      deviceToken: tokenOnlyFallback ? undefined : (cachedToken || undefined),
    },
  }
}
