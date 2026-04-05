import { EventEmitter } from 'events'

/**
 * Server-side event bus for broadcasting database mutations to SSE clients.
 * Singleton per Next.js server process.
 */

export interface ServerEvent {
  type: string
  data: any
  timestamp: number
}

// Event types emitted by the bus
export type EventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status_changed'
  | 'chat.message'
  | 'chat.message.deleted'
  | 'notification.created'
  | 'notification.read'
  | 'activity.created'
  | 'agent.updated'
  | 'agent.created'
  | 'agent.deleted'
  | 'agent.synced'
  | 'agent.status_changed'
  | 'audit.security'
  | 'security.event'
  | 'connection.created'
  | 'connection.disconnected'
  | 'github.synced'
  | 'health.check_completed'
  | 'health.circuit_tripped'
  | 'health.circuit_recovered'
  | 'health.recovery_attempted'
  | 'health.service_degraded'
  | 'health.service_restored'
  | 'learning.pattern_stored'
  | 'learning.pattern_applied'
  | 'learning.feedback_received'
  | 'improving.regression_detected'
  | 'improving.suggestion_created'
  | 'improving.cost_spike'
  | 'agent.cognitive_load_updated'
  | 'leaderboard.updated'
  | 'brief.generated'

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
  broadcast(type: EventType, data: any): ServerEvent {
    const event: ServerEvent = { type, data, timestamp: Date.now() }
    this.emit('server-event', event)
    return event
  }
}

// Use globalThis to survive HMR in development
const globalBus = globalThis as typeof globalThis & { __eventBus?: ServerEventBus }
export const eventBus = globalBus.__eventBus ?? ServerEventBus.getInstance()
globalBus.__eventBus = eventBus as ServerEventBus
