import { asFleetAgentName, type FleetAgentName } from '@/lib/fleet-agents'
import {
  listClaudeMcp,
  listCodexAutomations,
  listGrokPlugins,
  listKimiMcp,
  listOpenClawExtensions,
  listTomlMcp,
  type McpConnector,
} from '@/lib/cli-mcp'

export interface AgentInventory {
  agent: string
  runtime: string
  connectors: McpConnector[]
  plugins: string[]
  automations: string[]
}

function runtimeOf(name: FleetAgentName): string {
  if (name.startsWith('claude')) return 'claude'
  return name
}

export function inventoryForAgent(name: string): AgentInventory {
  const canonical = asFleetAgentName(name)
  if (!canonical) {
    return { agent: name, runtime: 'unknown', connectors: [], plugins: [], automations: [] }
  }
  const runtime = runtimeOf(canonical)
  const connectors: McpConnector[] = [...listOpenClawExtensions()]
  let plugins: string[] = []
  let automations: string[] = []
  if (runtime === 'claude') connectors.push(...listClaudeMcp())
  if (runtime === 'codex') {
    connectors.push(...listTomlMcp('codex', '.codex/config.toml'))
    automations = listCodexAutomations()
  }
  if (runtime === 'grok') {
    connectors.push(...listTomlMcp('grok', '.grok/config.toml'))
    plugins = listGrokPlugins()
  }
  if (runtime === 'kimi') connectors.push(...listKimiMcp())
  return { agent: name, runtime, connectors, plugins, automations }
}

export function inventoryLooksSafe(inventory: AgentInventory): boolean {
  const blob = JSON.stringify(inventory).toLowerCase()
  return !blob.includes('api_key') && !blob.includes('"sk-') && !blob.includes('authorization')
}
