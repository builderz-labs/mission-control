import { probeTypeSafeApiKey } from '@/lib/typesafe-probe'

export interface JevHealth {
  configured: boolean
  healthy: boolean
  lastCheckedAt: number | null
  errorCode: string | null
}

let cached: { value: JevHealth; expiresAt: number } | null = null
let pending: Promise<JevHealth> | null = null

export async function getJevHealth(apiKey = process.env.TYPESAFE_API_KEY?.trim() || ''): Promise<JevHealth> {
  if (!apiKey) return { configured: false, healthy: false, lastCheckedAt: null, errorCode: 'JEV_NOT_CONFIGURED' }
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (pending) return pending
  pending = probeTypeSafeApiKey(apiKey)
    .then((result) => ({
      configured: true, healthy: result.ok, lastCheckedAt: Date.now(),
      errorCode: result.ok ? null : 'JEV_HEALTH_CHECK_FAILED',
    }))
    .catch(() => ({
      configured: true, healthy: false, lastCheckedAt: Date.now(), errorCode: 'JEV_UNAVAILABLE',
    }))
    .then((value) => {
      cached = { value, expiresAt: Date.now() + (value.healthy ? 300_000 : 60_000) }
      pending = null
      return value
    })
  return pending
}
