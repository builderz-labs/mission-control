export interface AlertRule {
  id: number
  name: string
  description: string | null
  enabled: number
  entity_type: string
  condition_field: string
  condition_operator: string
  condition_value: string
  action_type: string
  action_config: string
  cooldown_minutes: number
  last_triggered_at: number | null
  trigger_count: number
  created_by: string
  created_at: number
  updated_at: number
}

export interface EvalResult {
  rule_id: number
  rule_name: string
  triggered: boolean
  reason?: string
}

export interface CreateRuleFormState {
  name: string
  description: string
  entity_type: string
  condition_field: string
  condition_operator: string
  condition_value: string
  cooldown_minutes: number
  recipient: string
}

export const ENTITY_FIELDS: Record<string, string[]> = {
  agent: ['status', 'role', 'name', 'last_seen', 'last_activity'],
  task: ['status', 'priority', 'assigned_to', 'title'],
  session: ['status'],
  activity: ['type', 'actor', 'entity_type'],
}

export const OPERATORS: { value: string; label: string }[] = [
  { value: 'equals', label: '=' },
  { value: 'not_equals', label: '!=' },
  { value: 'greater_than', label: '>' },
  { value: 'less_than', label: '<' },
  { value: 'contains', label: 'contains' },
  { value: 'count_above', label: 'count >' },
  { value: 'count_below', label: 'count <' },
  { value: 'age_minutes_above', label: 'age (min) >' },
]

export const ENTITY_COLORS: Record<string, string> = {
  agent: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  task: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  session: 'bg-green-500/20 text-green-400 border-green-500/30',
  activity: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
}
