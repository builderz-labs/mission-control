/**
 * GNAP Mapper Functions
 * Bidirectional mapping between SQLite and GNAP schemas
 */

import { Task, Agent } from '@/lib/db';
import { GNAPTask, GNAPAgent, GNAPComment } from './types';

/**
 * Status mappings: SQLite → GNAP
 */
const STATUS_MAP: Record<string, GNAPTask['state']> = {
  'inbox': 'backlog',
  'assigned': 'ready',
  'in_progress': 'in_progress',
  'review': 'review',
  'quality_review': 'review',
  'done': 'done'
};

/**
 * Status mappings: GNAP → SQLite
 */
const REVERSE_STATUS_MAP: Record<GNAPTask['state'], Task['status']> = {
  'backlog': 'inbox',
  'ready': 'assigned',
  'in_progress': 'in_progress',
  'review': 'review',
  'done': 'done',
  'blocked': 'assigned',
  'cancelled': 'assigned'
};

/**
 * Priority mappings: SQLite → GNAP
 */
const PRIORITY_MAP: Record<string, number> = {
  'low': 3,
  'medium': 2,
  'high': 1,
  'critical': 0,
  'urgent': 0
};

/**
 * Priority mappings: GNAP → SQLite
 */
const REVERSE_PRIORITY_MAP: Record<number, Task['priority']> = {
  0: 'critical',
  1: 'high',
  2: 'medium',
  3: 'low'
};

/**
 * Parse tags from JSON string
 */
function parseTags(tagsJson: string | undefined): string[] {
  if (!tagsJson) return [];
  try {
    return JSON.parse(tagsJson);
  } catch {
    return [];
  }
}

/**
 * Stringify tags to JSON
 */
function stringifyTags(tags: string[] | undefined): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  return JSON.stringify(tags);
}

/**
 * Extract system tags from GNAP tags
 */
function extractSystemTags(tags: string[] | undefined): {
  projectId?: number;
  githubIssueNumber?: number;
  githubRepo?: string;
} {
  const result: any = {};

  if (!tags) return result;

  for (const tag of tags) {
    if (tag.startsWith('project:')) {
      result.projectId = parseInt(tag.split(':')[1]);
    } else if (tag.startsWith('github:issue/')) {
      result.githubIssueNumber = parseInt(tag.split('/')[1]);
    } else if (tag.startsWith('github:repo/')) {
      result.githubRepo = tag.split('/')[1];
    }
  }

  return result;
}

/**
 * Create system tags from SQLite fields
 */
function createSystemTags(
  projectId?: number,
  githubIssueNumber?: number,
  githubRepo?: string
): string[] {
  const tags: string[] = [];

  if (projectId) tags.push(`project:${projectId}`);
  if (githubIssueNumber) tags.push(`github:issue/${githubIssueNumber}`);
  if (githubRepo) tags.push(`github:repo/${githubRepo}`);

  return tags;
}

/**
 * Convert SQLite Task to GNAP Task
 */
export function mapSQLiteTaskToGNAP(task: Task): GNAPTask {
  const existingTags = parseTags(task.tags);
  const systemTags = createSystemTags(
    task.project_id,
    task.github_issue_number,
    task.github_repo
  );
  const tags = [...existingTags, ...systemTags];

  return {
    id: String(task.id),
    title: task.title,
    assigned_to: task.assigned_to ? [task.assigned_to] : [],
    state: STATUS_MAP[task.status] || 'backlog',
    priority: PRIORITY_MAP[task.priority] || 2,
    created_by: task.created_by,
    created_at: new Date(task.created_at * 1000).toISOString(),
    parent: undefined,
    desc: task.description,
    due: task.due_date ? new Date(task.due_date * 1000).toISOString() : undefined,
    blocked: false,
    blocked_reason: undefined,
    reviewer: undefined,
    updated_at: new Date(task.updated_at * 1000).toISOString(),
    tags: tags.length > 0 ? tags : undefined,
    comments: []
  };
}

/**
 * Convert GNAP Task to SQLite Task
 */
export function mapGNAPTaskToSQLite(gnapTask: GNAPTask): Partial<Task> {
  const systemTags = extractSystemTags(gnapTask.tags);
  const existingTags = gnapTask.tags?.filter(t =>
    !t.startsWith('project:') &&
    !t.startsWith('github:')
  );

  return {
    id: parseInt(gnapTask.id),
    title: gnapTask.title,
    description: gnapTask.desc,
    status: REVERSE_STATUS_MAP[gnapTask.state] || 'inbox',
    priority: REVERSE_PRIORITY_MAP[gnapTask.priority] || 'medium',
    project_id: systemTags.projectId,
    assigned_to: gnapTask.assigned_to[0] || null,
    created_by: gnapTask.created_by,
    created_at: Math.floor(new Date(gnapTask.created_at).getTime() / 1000),
    updated_at: gnapTask.updated_at
      ? Math.floor(new Date(gnapTask.updated_at).getTime() / 1000)
      : Math.floor(new Date(gnapTask.created_at).getTime() / 1000),
    due_date: gnapTask.due
      ? Math.floor(new Date(gnapTask.due).getTime() / 1000)
      : null,
    tags: stringifyTags(existingTags),
    metadata: undefined,
    outcome: undefined,
    error_message: undefined,
    resolution: undefined,
    feedback_rating: undefined,
    feedback_notes: undefined,
    retry_count: undefined,
    completed_at: undefined,
    github_issue_number: systemTags.githubIssueNumber,
    github_repo: systemTags.githubRepo,
    github_synced_at: undefined,
    github_branch: undefined,
    github_pr_number: undefined,
    github_pr_state: undefined
  };
}

/**
 * Convert SQLite Agent to GNAP Agent
 */
export function mapSQLiteAgentToGNAP(agent: Agent): GNAPAgent {
  const capabilities = agent.config
    ? Object.keys(JSON.parse(agent.config))
    : [];

  return {
    id: String(agent.id),
    name: agent.name,
    role: agent.role,
    type: agent.session_key ? 'ai' : 'human',
    status: agent.status === 'offline'
      ? 'terminated'
      : agent.status === 'error'
        ? 'paused'
        : 'active',
    runtime: agent.session_key ? 'openclaw' : undefined,
    reports_to: undefined,
    heartbeat_sec: 300,
    contact: undefined,
    capabilities: capabilities.length > 0 ? capabilities : undefined
  };
}

/**
 * Convert GNAP Agent to SQLite Agent
 */
export function mapGNAPAgentToSQLite(gnapAgent: GNAPAgent): Partial<Agent> {
  const config = gnapAgent.capabilities
    ? JSON.stringify(gnapAgent.capabilities)
    : undefined;

  return {
    id: parseInt(gnapAgent.id),
    name: gnapAgent.name,
    role: gnapAgent.role,
    session_key: gnapAgent.runtime === 'openclaw' ? gnapAgent.id : undefined,
    soul_content: undefined,
    status: gnapAgent.status === 'active'
      ? 'idle'
      : gnapAgent.status === 'terminated'
        ? 'offline'
        : 'error',
    last_seen: undefined,
    last_activity: undefined,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    config
  };
}

/**
 * Convert SQLite Comment to GNAP Comment
 */
export function mapSQLiteCommentToGNAP(comment: any): GNAPComment {
  return {
    by: comment.author,
    at: new Date(comment.created_at * 1000).toISOString(),
    text: comment.content
  };
}

/**
 * Convert GNAP Comment to SQLite Comment
 */
export function mapGNAPCommentToSQLite(
  gnapComment: GNAPComment,
  taskId: number
): any {
  return {
    task_id: taskId,
    author: gnapComment.by,
    content: gnapComment.text,
    created_at: Math.floor(new Date(gnapComment.at).getTime() / 1000),
    parent_id: undefined,
    mentions: undefined
  };
}

/**
 * Check if SQLite task needs syncing to GNAP
 */
export function needsSyncToGNAP(sqliteTask: Task, gnapTask: GNAPTask | null): boolean {
  if (!gnapTask) return true;

  const sqliteUpdated = sqliteTask.updated_at;
  const gnapUpdated = gnapTask.updated_at
    ? Math.floor(new Date(gnapTask.updated_at).getTime() / 1000)
    : 0;

  return sqliteUpdated > gnapUpdated;
}

/**
 * Check if GNAP task needs syncing to SQLite
 */
export function needsSyncFromGNAP(
  sqliteTask: Task | null,
  gnapTask: GNAPTask
): boolean {
  if (!sqliteTask) return true;

  const sqliteUpdated = sqliteTask.updated_at;
  const gnapUpdated = gnapTask.updated_at
    ? Math.floor(new Date(gnapTask.updated_at).getTime() / 1000)
    : 0;

  return gnapUpdated > sqliteUpdated;
}

/**
 * Merge SQLite and GNAP tasks (conflict resolution)
 */
export function mergeTasks(sqliteTask: Task, gnapTask: GNAPTask): GNAPTask {
  // Use the most recent version as base
  const sqliteUpdated = sqliteTask.updated_at;
  const gnapUpdated = gnapTask.updated_at
    ? Math.floor(new Date(gnapTask.updated_at).getTime() / 1000)
    : 0;

  if (sqliteUpdated > gnapUpdated) {
    // SQLite is newer
    return mapSQLiteTaskToGNAP(sqliteTask);
  } else {
    // GNAP is newer
    return gnapTask;
  }
}

/**
 * Merge SQLite and GNAP agents (conflict resolution)
 */
export function mergeAgents(sqliteAgent: Agent, gnapAgent: GNAPAgent): GNAPAgent {
  // Use the most recent version as base
  const sqliteUpdated = sqliteAgent.updated_at;
  const gnapUpdated = gnapAgent.updated_at
    ? Math.floor(new Date(gnapAgent.updated_at).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  if (sqliteUpdated > gnapUpdated) {
    // SQLite is newer
    return mapSQLiteAgentToGNAP(sqliteAgent);
  } else {
    // GNAP is newer
    return gnapAgent;
  }
}
