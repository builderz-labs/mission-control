import { eventBus } from '@/lib/event-bus'
import { queryPendingAssignments } from './adapter'
import type { FrameworkAdapter, AgentRegistration, HeartbeatPayload, TaskReport, Assignment } from './adapter'

export class CrewAIAdapter implements FrameworkAdapter {
  readonly framework = 'crewai'

  async register(agent: AgentRegistration): Promise<void> {
    eventBus.broadcast('agent.created', {
      workspace_id: agent.workspaceId,
      id: agent.agentId,
      name: agent.name,
      framework: this.framework,
      status: 'online',
      ...(agent.metadata ?? {}),
    })
  }

  async heartbeat(payload: HeartbeatPayload): Promise<void> {
    eventBus.broadcast('agent.status_changed', {
      workspace_id: payload.workspaceId,
      id: payload.agentId,
      status: payload.status,
      metrics: payload.metrics ?? {},
      framework: this.framework,
    })
  }

  async reportTask(report: TaskReport): Promise<void> {
    eventBus.broadcast('task.updated', {
      workspace_id: report.workspaceId,
      id: report.taskId,
      agentId: report.agentId,
      progress: report.progress,
      status: report.status,
      output: report.output,
      framework: this.framework,
    })
  }

  async getAssignments(agentId: string, workspaceId: number): Promise<Assignment[]> {
    return queryPendingAssignments(agentId, workspaceId)
  }

  async disconnect(agentId: string, workspaceId: number): Promise<void> {
    eventBus.broadcast('agent.status_changed', {
      workspace_id: workspaceId,
      id: agentId,
      status: 'offline',
      framework: this.framework,
    })
  }
}
