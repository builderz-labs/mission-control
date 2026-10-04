import type {
  FactoryActionAvailability,
  FactoryDefinition,
  FactorySnapshot,
} from '../types'

export interface FactoryDiscoveredInstance {
  instance_id: string
  module_id: string
  adapter_id: string
  native_id: string
  root_path: string
  config: Record<string, unknown>
}

export interface FactoryHealth {
  ok: boolean
  detail: string
  checked_at: string
}

export interface FactoryCommandRequest {
  command_id: string
  arguments: Record<string, unknown>
  expected_revision?: string | null
  requested_by: string
}

export interface FactoryCommandResult {
  state: 'APPLIED' | 'FAILED' | 'STALE' | 'UNKNOWN'
  before_revision: string | null
  after_revision: string | null
  stdout_excerpt: string
  stderr_excerpt: string
  error: string | null
  snapshot: FactorySnapshot | null
}

export interface FactoryAdapter {
  readonly id: string
  readonly moduleId: string

  getDefinition(): FactoryDefinition
  discoverInstances(): Promise<FactoryDiscoveredInstance[]>
  healthCheck(instance: FactoryDiscoveredInstance): Promise<FactoryHealth>
  getSnapshot(instance: FactoryDiscoveredInstance): Promise<FactorySnapshot>
  getAvailableCommands(snapshot: FactorySnapshot): FactoryActionAvailability[]
  canExecute?(snapshot: FactorySnapshot, request: FactoryCommandRequest): FactoryActionAvailability
  execute?(instance: FactoryDiscoveredInstance, request: FactoryCommandRequest): Promise<FactoryCommandResult>
}
