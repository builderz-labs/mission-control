// Domain entity interfaces for the database layer.
// Kept in one place so all db modules and consumers share the same types
// without circular imports.

export interface CountRow { count: number }

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  project_id?: number;
  project_ticket_no?: number;
  project_name?: string;
  project_prefix?: string;
  ticket_ref?: string;
  assigned_to?: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  due_date?: number;
  estimated_hours?: number;
  actual_hours?: number;
  outcome?: 'success' | 'failed' | 'partial' | 'abandoned';
  error_message?: string;
  resolution?: string;
  feedback_rating?: number;
  feedback_notes?: string;
  retry_count?: number;
  completed_at?: number;
  tags?: string; // JSON string
  metadata?: string; // JSON string
}

export interface Agent {
  id: number;
  name: string;
  role: string;
  session_key?: string;
  soul_content?: string;
  status: 'offline' | 'idle' | 'busy' | 'error';
  last_seen?: number;
  last_activity?: string;
  created_at: number;
  updated_at: number;
  config?: string; // JSON string
}

export interface Comment {
  id: number;
  task_id: number;
  author: string;
  content: string;
  created_at: number;
  parent_id?: number;
  mentions?: string; // JSON string
}

export interface Activity {
  id: number;
  type: string;
  entity_type: string;
  entity_id: number;
  actor: string;
  description: string;
  data?: string; // JSON string
  created_at: number;
}

export interface Message {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent?: string;
  content: string;
  message_type: string;
  metadata?: string; // JSON string
  read_at?: number;
  created_at: number;
}

export interface Notification {
  id: number;
  recipient: string;
  type: string;
  title: string;
  message: string;
  source_type?: string;
  source_id?: number;
  read_at?: number;
  delivered_at?: number;
  created_at: number;
}

export interface Tenant {
  id: number
  slug: string
  display_name: string
  linux_user: string
  plan_tier: string
  status: 'pending' | 'provisioning' | 'active' | 'suspended' | 'error'
  openclaw_home: string
  workspace_root: string
  gateway_port?: number
  dashboard_port?: number
  config?: string
  created_by: string
  owner_gateway?: string
  created_at: number
  updated_at: number
}

export interface Workspace {
  id: number
  slug: string
  name: string
  tenant_id: number
  created_at: number
  updated_at: number
}

export interface ProvisionJob {
  id: number
  tenant_id: number
  job_type: 'bootstrap' | 'update' | 'decommission'
  status: 'queued' | 'approved' | 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled'
  dry_run: 0 | 1
  requested_by: string
  approved_by?: string
  runner_host?: string
  idempotency_key?: string
  request_json?: string
  plan_json?: string
  result_json?: string
  error_text?: string
  started_at?: number
  completed_at?: number
  created_at: number
  updated_at: number
}

export interface ProvisionEvent {
  id: number
  job_id: number
  level: 'info' | 'warn' | 'error'
  step_key?: string
  message: string
  data?: string
  created_at: number
}
