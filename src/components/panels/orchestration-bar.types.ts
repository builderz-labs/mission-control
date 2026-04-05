export interface Agent {
  id: number
  name: string
  role: string
  status: string
  session_key?: string
}

export interface WorkflowTemplate {
  id: number
  name: string
  description: string | null
  model: string
  task_prompt: string
  timeout_seconds: number
  agent_role: string | null
  tags: string[]
  use_count: number
  last_used_at: number | null
}

export type TemplateFormData = {
  name: string
  description: string
  model: string
  task_prompt: string
  timeout_seconds: number
  agent_role: string
  tags: string[]
}

export const emptyForm: TemplateFormData = {
  name: '', description: '', model: 'sonnet', task_prompt: '',
  timeout_seconds: 300, agent_role: '', tags: [],
}

export type ActiveTab = 'command' | 'templates' | 'pipelines' | 'fleet'
