import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inventoryForAgent } from '@/lib/cli-inventory'

const BEGIN = '<!-- generated:cli-inventory -->'
const END = '<!-- /generated:cli-inventory -->'

function generatedBlock(name: string, kind: 'tools' | 'mission'): string {
  const inventory = inventoryForAgent(name)
  if (kind === 'tools') {
    const connectors = inventory.connectors.map((item) => `- ${item.cli}: ${item.name}`).join('\n') || '- none listed'
    return `${BEGIN}
# Tools

Live CLI + OpenClaw inventory. Secrets are not copied here.

## MCP / extensions

${connectors}

## Plugins

${inventory.plugins.map((item) => `- ${item}`).join('\n') || '- none'}

## Automations

${inventory.automations.map((item) => `- ${item}`).join('\n') || '- none'}
${END}
`
  }
  return `${BEGIN}
# Mission

Fleet identity \`${name}\` (${inventory.runtime}). Shared brain: Omnia Vault. Skills: \`~/.agents/skills\`. Dashboard: Mission Control.

Stamp handoff with \`--agent ${name}\`.
${END}
`
}

function mergeGenerated(existing: string, block: string): string {
  if (!existing.trim()) return block
  if (existing.includes(BEGIN) && existing.includes(END)) {
    return existing.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block.trim())
  }
  return `${block}\n${existing}`
}

export function ensureWorkspaceGeneratedFiles(workspace: string, agentName: string): void {
  mkdirSync(workspace, { recursive: true })
  for (const file of ['TOOLS.md', 'MISSION.md'] as const) {
    const path = join(workspace, file)
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (current && !current.includes(BEGIN) && current.trim().length > 40) continue
    const kind = file === 'TOOLS.md' ? 'tools' : 'mission'
    writeFileSync(path, mergeGenerated(current, generatedBlock(agentName, kind)), 'utf8')
  }
  const userPath = join(workspace, 'USER.md')
  if (!existsSync(userPath)) {
    writeFileSync(userPath, '# USER\n\nOperator notes for this identity.\n', 'utf8')
  }
}
