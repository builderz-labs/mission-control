import { OpenClawAdapter } from './openclaw'
import { GenericAdapter } from './generic'
import { CrewAIAdapter } from './crewai'
import { LangGraphAdapter } from './langgraph'
import { AutoGenAdapter } from './autogen'
import { ClaudeSdkAdapter } from './claude-sdk'
import type { FrameworkAdapter } from './adapter'

const adapters = new Map<string, () => FrameworkAdapter>([
  ['openclaw', () => new OpenClawAdapter()],
  ['generic', () => new GenericAdapter()],
  ['crewai', () => new CrewAIAdapter()],
  ['langgraph', () => new LangGraphAdapter()],
  ['autogen', () => new AutoGenAdapter()],
  ['claude-sdk', () => new ClaudeSdkAdapter()],
])

export function getAdapter(framework: string): FrameworkAdapter {
  const factory = adapters.get(framework)
  if (!factory) throw new Error(`Unknown framework adapter: ${framework}`)
  return factory()
}

export function listAdapters(): string[] {
  return Array.from(adapters.keys())
}

export type { FrameworkAdapter, AgentRegistration, HeartbeatPayload, TaskReport, Assignment } from './adapter'
