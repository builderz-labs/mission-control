import { getDatabase } from '@/lib/db'

export function hasOpenAIQuotaAvailable() {
  if ((process.env.OPENAI_API_KEY || '').trim()) return true

  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT COUNT(*) AS c
      FROM credentials
      WHERE LOWER(name) LIKE '%openai%'
         OR LOWER(name) LIKE '%chatgpt%'
         OR LOWER(value) LIKE 'sk-%'
    `).get() as { c?: number }
    return (row?.c || 0) > 0
  } catch {
    return false
  }
}

export function isAgentAvailable(agentName: string) {
  if (agentName.toLowerCase() === 'chatgpt') {
    return hasOpenAIQuotaAvailable()
  }
  return true
}
