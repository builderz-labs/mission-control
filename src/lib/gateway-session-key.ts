export const GATEWAY_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,200}$/
const AGENT_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/

export function extractAgentName(sessionKey: string): string | null {
  if (!GATEWAY_KEY_RE.test(sessionKey) || sessionKey.includes('..')) return null
  const parts = sessionKey.split(':')
  if (parts[0] !== 'agent' || !AGENT_NAME_RE.test(parts[1] || '')) return null
  return parts[1]
}
