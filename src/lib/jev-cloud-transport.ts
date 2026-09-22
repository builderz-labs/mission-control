export const JEV_SUPABASE_PROJECT_REF = 'nivlxzlxnfsgashuomxb'

export class JevCloudError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'JevCloudError' }
}

export interface JevCloudConfiguration { url: string; secretKey: string }

export function getJevCloudConfiguration(env: Record<string, string | undefined> = process.env): JevCloudConfiguration | null {
  if (typeof window !== 'undefined') throw new JevCloudError('JEV_CLOUD_SERVER_ONLY')
  const value = env.MC_SUPABASE_URL?.trim()
  const ref = env.MC_SUPABASE_PROJECT_REF?.trim()
  const secretKey = env.MC_SUPABASE_SECRET_KEY?.trim()
  if (!value && !ref && !secretKey) return null
  if (!value || !secretKey || ref !== JEV_SUPABASE_PROJECT_REF) {
    throw new JevCloudError('JEV_CLOUD_CONFIGURATION_INVALID')
  }
  let url: URL
  try { url = new URL(value) } catch { throw new JevCloudError('JEV_CLOUD_CONFIGURATION_INVALID') }
  if (url.protocol !== 'https:' || url.hostname !== `${JEV_SUPABASE_PROJECT_REF}.supabase.co`
    || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey)) {
    throw new JevCloudError('JEV_CLOUD_CONFIGURATION_INVALID')
  }
  return { url: url.origin, secretKey }
}

export async function deliverJevCloudEvent(
  configuration: JevCloudConfiguration,
  payload: string,
  request: typeof fetch = fetch,
): Promise<void> {
  // Revalidate even injected configurations so no caller can redirect credentials.
  getJevCloudConfiguration({ MC_SUPABASE_URL: configuration.url,
    MC_SUPABASE_PROJECT_REF: JEV_SUPABASE_PROJECT_REF, MC_SUPABASE_SECRET_KEY: configuration.secretKey })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await request(`${configuration.url}/rest/v1/mission_control_jev_events?on_conflict=origin_instance_id,event_id`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { apikey: configuration.secretKey, 'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: payload,
      })
      if (response.ok) return
      if (response.status === 401 || response.status === 403) throw new JevCloudError('JEV_CLOUD_ACCESS_DENIED')
      if (response.status === 404) throw new JevCloudError('JEV_CLOUD_SCHEMA_UNAVAILABLE')
      throw new JevCloudError(response.status === 429 ? 'JEV_CLOUD_RATE_LIMITED' : 'JEV_CLOUD_UNAVAILABLE')
    } catch (error) {
      if (attempt === 1) throw error instanceof JevCloudError ? error : new JevCloudError('JEV_CLOUD_UNAVAILABLE')
    }
  }
}
