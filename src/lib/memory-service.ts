/**
 * Memory Service Layer for Mission Control
 * Provides unified memory/state operations across all agents
 *
 * CANONICAL WRITE PATH: scripts/memory-service.cjs
 * addMemoryEntry and queryMemory delegate to the CJS layer via
 * src/lib/server/memory-service-wrapper.ts so there is a single
 * write path across both CLI and API. All other functions in this
 * file (registerAgent, createSession, etc.) use the DB directly
 * because they are not replicated in the CJS service.
 */

import { createRequire } from 'node:module';
import { getDatabase } from './db.js';

const _cjsLoad = createRequire(import.meta.url);
const _memSvc  = _cjsLoad('../../scripts/memory-service.cjs') as {
  writeMemory:  (source: string, category: string, content: string, meta?: Record<string, unknown>) => { id: number };
  queryMemory:  (searchTerm: string, filters?: { source?: string; category?: string }) => unknown[];
};

// ============================================================================
// AGENT OPERATIONS
// ============================================================================

export async function registerAgent(data: {
  name: string;
  type?: string;
  provider?: string;
  role: string;
  source_path?: string;
  config_path?: string;
  status?: string;
}): Promise<{ id: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO agents (name, type, provider, role, source_path, config_path, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `);
  const result = stmt.run(
    data.name,
    data.type || 'unknown',
    data.provider || 'local',
    data.role,
    data.source_path || null,
    data.config_path || null,
    data.status || 'offline'
  );
  return { id: Number(result.lastInsertRowid) };
}

export async function listAgents(filters?: {
  type?: string;
  provider?: string;
  status?: string;
}): Promise<any[]> {
  const db = getDatabase();
  let query = 'SELECT * FROM agents WHERE 1=1';
  const params: any[] = [];
  
  if (filters?.type) {
    query += ' AND type = ?';
    params.push(filters.type);
  }
  if (filters?.provider) {
    query += ' AND provider = ?';
    params.push(filters.provider);
  }
  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  
  query += ' ORDER BY created_at DESC';
  return db.prepare(query).all(...params);
}

// ============================================================================
// SESSION OPERATIONS
// ============================================================================

export async function createSession(data: {
  agent_id: number;
  project?: string;
  branch?: string;
}): Promise<{ id: string }> {
  const db = getDatabase();
  const { randomUUID } = await import('crypto');
  const sessionId = randomUUID();
  
  const stmt = db.prepare(`
    INSERT INTO sessions_v2 (id, agent_id, project, branch, started_at, status)
    VALUES (?, ?, ?, ?, unixepoch(), 'active')
  `);
  stmt.run(sessionId, data.agent_id, data.project || null, data.branch || null);
  return { id: sessionId };
}

export async function endSession(sessionId: string, summary?: string): Promise<void> {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE sessions_v2 SET ended_at = unixepoch(), status = 'completed', summary = ?
    WHERE id = ?
  `);
  stmt.run(summary || null, sessionId);
}

export async function listSessions(filters?: {
  agent_id?: number;
  status?: string;
}): Promise<any[]> {
  const db = getDatabase();
  let query = 'SELECT * FROM sessions_v2 WHERE 1=1';
  const params: any[] = [];
  
  if (filters?.agent_id) {
    query += ' AND agent_id = ?';
    params.push(filters.agent_id);
  }
  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  
  query += ' ORDER BY started_at DESC';
  return db.prepare(query).all(...params);
}

// ============================================================================
// TASK OPERATIONS  
// ============================================================================

export async function createTask(data: {
  title: string;
  description?: string;
  session_id?: string;
  track?: string;
  risk_level?: string;
  assigned_to?: string;
}): Promise<{ id: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, session_id, track, risk_level, assigned_to, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `);
  const result = stmt.run(
    data.title,
    data.description || null,
    data.session_id || null,
    data.track || 'general',
    data.risk_level || 'low',
    data.assigned_to || null
  );
  return { id: Number(result.lastInsertRowid) };
}

export async function updateTaskStatus(taskId: number, status: string): Promise<void> {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE tasks SET status = ?, updated_at = unixepoch()
    WHERE id = ?
  `);
  stmt.run(status, taskId);
}

export async function listTasks(filters?: {
  track?: string;
  risk_level?: string;
  status?: string;
}): Promise<any[]> {
  const db = getDatabase();
  let query = 'SELECT * FROM tasks WHERE 1=1';
  const params: any[] = [];
  
  if (filters?.track) {
    query += ' AND track = ?';
    params.push(filters.track);
  }
  if (filters?.risk_level) {
    query += ' AND risk_level = ?';
    params.push(filters.risk_level);
  }
  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  
  query += ' ORDER BY created_at DESC';
  return db.prepare(query).all(...params);
}

// ============================================================================
// MEMORY ENTRY OPERATIONS
// ============================================================================

export async function addMemoryEntry(data: {
  source: string;
  source_ref?: string;
  project?: string;
  category?: string;
  content: string;
  confidence?: number;
  tags?: string[];
}): Promise<{ id: number }> {
  // Delegate to CJS service — single canonical write path.
  return _memSvc.writeMemory(data.source, data.category || 'general', data.content, {
    sourceRef:  data.source_ref  ?? null,
    project:    data.project     ?? null,
    confidence: data.confidence  ?? 1.0,
    tags:       data.tags?.join(',') ?? null,
  });
}

export async function queryMemory(query: string, options?: {
  source?: string;
  category?: string;
  project?: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any[]> {
  // Delegate to CJS service.
  return _memSvc.queryMemory(query, { source: options?.source, category: options?.category }) as any[];
}

/** @deprecated — kept for reference only; logic moved to CJS */
async function _queryMemoryDirect(query: string, options?: {
  source?: string;
  category?: string;
  project?: string;
}): Promise<any[]> {
  const db = getDatabase();
  let sql = 'SELECT * FROM memory_entries WHERE content LIKE ?';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [`%${query}%`];

  if (options?.source) {
    sql += ' AND source = ?';
    params.push(options.source);
  }
  if (options?.category) {
    sql += ' AND category = ?';
    params.push(options.category);
  }
  if (options?.project) {
    sql += ' AND project = ?';
    params.push(options.project);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT 50';
  return db.prepare(sql).all(...params);
}

// ============================================================================
// DECISION OPERATIONS
// ============================================================================

export async function recordDecision(data: {
  task_id?: number;
  title: string;
  decision: string;
  rationale?: string;
  alternatives_considered?: string[];
  risk?: string;
}): Promise<{ id: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO decisions (task_id, title, decision, rationale, alternatives_considered, risk, created_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  `);
  const result = stmt.run(
    data.task_id || null,
    data.title,
    data.decision,
    data.rationale || null,
    JSON.stringify(data.alternatives_considered || []),
    data.risk || 'low'
  );
  return { id: Number(result.lastInsertRowid) };
}

// ============================================================================
// CHECK OPERATIONS
// ============================================================================

export async function recordCheck(data: {
  task_id?: number;
  command: string;
  status?: string;
  output_summary?: string;
}): Promise<{ id: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO checks (task_id, command, status, output_summary, started_at)
    VALUES (?, ?, ?, ?, unixepoch())
  `);
  const result = stmt.run(
    data.task_id || null,
    data.command,
    data.status || 'pending',
    data.output_summary || null
  );
  return { id: Number(result.lastInsertRowid) };
}

export async function completeCheck(checkId: number, status: string, outputSummary?: string): Promise<void> {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE checks SET status = ?, output_summary = ?, completed_at = unixepoch()
    WHERE id = ?
  `);
  stmt.run(status, outputSummary || null, checkId);
}

// ============================================================================
// GIT EVENT OPERATIONS
// ============================================================================

export async function recordGitEvent(data: {
  task_id?: number;
  repo: string;
  branch: string;
  commit_hash?: string;
  event_type: string;
  status?: string;
}): Promise<{ id: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO git_events (task_id, repo, branch, commit_hash, event_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  `);
  const result = stmt.run(
    data.task_id || null,
    data.repo,
    data.branch,
    data.commit_hash || null,
    data.event_type,
    data.status || 'pending'
  );
  return { id: Number(result.lastInsertRowid) };
}

// ============================================================================
// RISK OPERATIONS
// ============================================================================

export async function recordRisk(data: {
  task_id?: number;
  severity: string;
  description: string;
  mitigation?: string;
}): Promise<{ id: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO risks (task_id, severity, description, mitigation, created_at, updated_at)
    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
  `);
  const result = stmt.run(
    data.task_id || null,
    data.severity,
    data.description,
    data.mitigation || null
  );
  return { id: Number(result.lastInsertRowid) };
}

export async function listRisks(filters?: {
  severity?: string;
  status?: string;
}): Promise<any[]> {
  const db = getDatabase();
  let query = 'SELECT * FROM risks WHERE 1=1';
  const params: any[] = [];
  
  if (filters?.severity) {
    query += ' AND severity = ?';
    params.push(filters.severity);
  }
  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  
  query += ' ORDER BY created_at DESC';
  return db.prepare(query).all(...params);
}

export async function updateRiskStatus(riskId: number, status: string, mitigation?: string): Promise<void> {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE risks SET status = ?, mitigation = ?, updated_at = unixepoch()
    WHERE id = ?
  `);
  stmt.run(status, mitigation || null, riskId);
}