import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '@/lib/config'

const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

export function agentInboxDir(agentName: string, stateDir = config.openclawStateDir): string {
  if (!AGENT_NAME_RE.test(agentName)) {
    throw new Error('Invalid agent name for inbox')
  }
  return join(stateDir, `workspace-${agentName}`, 'inbox')
}

export function writeAgentInbox(
  agentName: string,
  from: string,
  message: string,
  stateDir = config.openclawStateDir,
): string {
  const dir = agentInboxDir(agentName, stateDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const filePath = join(dir, `${Date.now()}-${randomUUID()}.md`)
  const safeFrom = String(from || 'system').replace(/[\r\n]/g, ' ').slice(0, 80)
  writeFileSync(filePath, `# From ${safeFrom}\n\n${message}\n`, { encoding: 'utf8', mode: 0o600 })
  return filePath
}
