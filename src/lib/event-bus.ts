import { EventEmitter } from 'events'

/**
 * Server-side event bus for broadcasting database mutations to SSE clients.
 * Singleton per Next.js server process.
 */

// Event data type map — maps each event type to its payload shape
export interface EventDataMap {
  // Existing events (backward compatible)
  'task.created': Record<string, unknown>
  'task.updated': Record<string, unknown>
  'task.deleted': Record<string, unknown>
  'task.status_changed': Record<string, unknown>
  'chat.message': Record<string, unknown>
  'chat.message.deleted': Record<string, unknown>
  'notification.created': Record<string, unknown>
  'notification.read': Record<string, unknown>
  'activity.created': Record<string, unknown>
  'agent.updated': Record<string, unknown>
  'agent.created': Record<string, unknown>
  'agent.deleted': Record<string, unknown>
  'agent.synced': Record<string, unknown>
  'agent.status_changed': Record<string, unknown>
  'audit.security': Record<string, unknown>
  'security.event': Record<string, unknown>
  'connection.created': Record<string, unknown>
  'connection.disconnected': Record<string, unknown>
  'github.synced': Record<string, unknown>
  'virtual-office.message': Record<string, unknown>
  'virtual-office.cleared': Record<string, unknown>

  // Spatial visualization events
  'spatial.node.added': { nodeId: string; agentId: number; agentName: string }
  'spatial.node.removed': { nodeId: string; agentId: number }
  'spatial.layout.changed': { nodeCount: number }
  'spatial.edge.added': { edgeId: string; sourceAgentId: number; targetAgentId: number; type: string }
  'spatial.edge.removed': { edgeId: string }
  'spatial.positions.updated': { count: number }

  // Workflow engine events
  'workflow.created': { workflowId: number; name: string }
  'workflow.run.started': { runId: number; workflowId: number; templateName: string }
  'workflow.run.completed': { runId: number; status: 'completed' | 'failed' }
  'workflow.phase.transition': { runId: number; fromPhase: string; toPhase: string }
  'workflow.phase.approval_required': { runId: number; phaseId: number; phaseName: string }

  // Team chat (@mention) events
  'chat.mention.routed': { messageId: number; targetAgent: string; conversationId: string }
  'chat.mention.response': { messageId: number; agentName: string; conversationId: string }
  'chat.mention.loop_prevented': { conversationId: string; agentName: string; turnCount: number }

  // Debate/consensus events
  'debate.created': { debateId: number; topic: string; participantCount: number }
  'debate.round.started': { debateId: number; roundNumber: number; phase: string }
  'debate.round.completed': { debateId: number; roundNumber: number }
  'debate.argument.submitted': { debateId: number; agentName: string; roundNumber: number }
  'debate.vote.cast': { debateId: number; agentName: string; vote: 'accept' | 'reject' }
  'debate.concluded': { debateId: number; outcome: string; voteCount: { accept: number; reject: number } }

  // Persona simulation events
  'persona.emotional_state.changed': { agentId: number; pleasure: number; arousal: number; dominance: number }
  'persona.trust.updated': { fromAgentId: number; toAgentId: number; trustScore: number }

  // Auto-scaling events
  'scaling.evaluation.triggered': { queueDepth: number; activeAgents: number; threshold: number }
  'scaling.hire.requested': { requestId: string; taskType: string; reason: string }
  'scaling.hire.approved': { requestId: string; agentId: number; templateName: string }
  'scaling.retire.initiated': { agentId: number; reason: string; idleDuration: number }
}

export type EventType = keyof EventDataMap

export interface ServerEvent {
  type: string
  data: Record<string, unknown>
  timestamp: number
}

class ServerEventBus extends EventEmitter {
  private static instance: ServerEventBus | null = null

  private constructor() {
    super()
    this.setMaxListeners(50)
  }

  static getInstance(): ServerEventBus {
    if (!ServerEventBus.instance) {
      ServerEventBus.instance = new ServerEventBus()
    }
    return ServerEventBus.instance
  }

  /**
   * Broadcast an event to all SSE listeners
   */
  broadcast<T extends EventType>(type: T, data: EventDataMap[T]): ServerEvent {
    const event: ServerEvent = { type, data: data as Record<string, unknown>, timestamp: Date.now() }
    this.emit('server-event', event)
    return event
  }
}

// Use globalThis to survive HMR in development
const globalBus = globalThis as typeof globalThis & { __eventBus?: ServerEventBus }
export const eventBus = globalBus.__eventBus ?? ServerEventBus.getInstance()
globalBus.__eventBus = eventBus as ServerEventBus
