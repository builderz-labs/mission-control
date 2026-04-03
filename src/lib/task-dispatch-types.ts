// ---------------------------------------------------------------------------
// Task Dispatch — shared interfaces
// ---------------------------------------------------------------------------

export interface DispatchableTask {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string
  workspace_id: number
  agent_name: string
  agent_id: number
  agent_config: string | null
  ticket_prefix: string | null
  project_ticket_no: number | null
  project_id: number | null
  tags?: string[]
}

export interface AgentResponseParsed {
  text: string | null
  sessionId: string | null
}

export interface ReviewableTask {
  id: number
  title: string
  description: string | null
  resolution: string | null
  assigned_to: string | null
  agent_config: string | null
  workspace_id: number
  ticket_prefix: string | null
  project_ticket_no: number | null
}
