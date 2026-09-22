export const AGENT_RUNTIME_TYPES = [
  'hermes',
  'openclaw',
  'claude',
  'codex',
  'grok',
  'kimi',
  'custom',
] as const

export type AgentRuntimeType = (typeof AGENT_RUNTIME_TYPES)[number]

export function isAgentRuntimeType(value: string): value is AgentRuntimeType {
  return (AGENT_RUNTIME_TYPES as readonly string[]).includes(value)
}
