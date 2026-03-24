import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveWithin } from '@/lib/paths';
import { getAgentWorkspaceCandidates, readAgentWorkspaceFile } from '@/lib/agent-workspace';
import type Database from 'better-sqlite3';

// 512KB — generous but bounded. Prevents unbounded growth from append mode.
const MAX_WORKING_MEMORY_SIZE = 512 * 1024;

function getAgentByIdOrName(db: Database.Database, agentId: string, workspaceId: number): any {
  if (isNaN(Number(agentId))) {
    return db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
  }
  return db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
}

function agentColumnName(agentId: string): 'name' | 'id' {
  return isNaN(Number(agentId)) ? 'name' : 'id';
}

function agentColumnValue(agentId: string): string | number {
  return isNaN(Number(agentId)) ? agentId : Number(agentId);
}

/**
 * GET /api/agents/[id]/memory - Get agent's working memory
 *
 * Working memory is stored in the agents.working_memory DB column.
 * This endpoint is per-agent scratchpad memory (not the global Memory Browser filesystem view).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const workspaceId = auth.user.workspace_id ?? 1;

    const agent = getAgentByIdOrName(db, agentId, workspaceId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Read DB working memory + updated_at for staleness comparison
    const col = agentColumnName(agentId);
    const val = agentColumnValue(agentId);
    const dbResult = db.prepare(
      `SELECT working_memory, updated_at FROM agents WHERE ${col} = ? AND workspace_id = ?`
    ).get(val, workspaceId) as any;
    const dbMemory = dbResult?.working_memory || '';
    const dbUpdatedAt = dbResult?.updated_at || 0;

    // Try workspace WORKING.md, but prefer DB if DB is newer (fixes stale workspace after failed write)
    let workingMemory = '';
    let source: 'workspace' | 'database' | 'none' = 'none';
    try {
      const agentConfig = agent.config ? JSON.parse(agent.config) : {};
      const candidates = getAgentWorkspaceCandidates(agentConfig, agent.name);
      const match = readAgentWorkspaceFile(candidates, ['WORKING.md', 'working.md', 'MEMORY.md', 'memory.md']);
      if (match.exists && match.path) {
        const wsMtime = Math.floor(statSync(match.path).mtimeMs / 1000);
        if (dbUpdatedAt > wsMtime && dbMemory) {
          // DB is newer — workspace write likely failed on last PUT
          workingMemory = dbMemory;
          source = 'database';
        } else {
          workingMemory = match.content;
          source = 'workspace';
        }
      }
    } catch (err) {
      logger.warn({ err, agent: agent.name }, 'Failed to read WORKING.md from workspace');
    }

    if (!workingMemory) {
      workingMemory = dbMemory;
      source = workingMemory ? 'database' : 'none';
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role
      },
      working_memory: workingMemory,
      source,
      updated_at: agent.updated_at,
      size: workingMemory.length
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/memory error');
    return NextResponse.json({ error: 'Failed to fetch working memory' }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/memory - Update agent's working memory
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json();
    const { working_memory, append } = body;

    const agent = getAgentByIdOrName(db, agentId, workspaceId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    let newContent = working_memory || '';

    // Handle append mode
    if (append) {
      const col = agentColumnName(agentId);
      const val = agentColumnValue(agentId);
      const current = db.prepare(
        `SELECT working_memory FROM agents WHERE ${col} = ? AND workspace_id = ?`
      ).get(val, workspaceId) as any;
      const currentContent = current?.working_memory || '';

      const timestamp = new Date().toISOString();
      newContent = currentContent + (currentContent ? '\n\n' : '') +
                   `## ${timestamp}\n${working_memory}`;
    }

    // Size guard — prevent unbounded growth
    if (newContent.length > MAX_WORKING_MEMORY_SIZE) {
      return NextResponse.json({
        error: `Working memory exceeds ${MAX_WORKING_MEMORY_SIZE} bytes (${newContent.length} bytes). Consider clearing old entries.`,
      }, { status: 413 });
    }

    const now = Math.floor(Date.now() / 1000);

    // Best effort: sync workspace WORKING.md if agent workspace is configured
    let savedToWorkspace = false;
    try {
      const agentConfig = agent.config ? JSON.parse(agent.config) : {};
      const candidates = getAgentWorkspaceCandidates(agentConfig, agent.name);
      const safeWorkspace = candidates[0];
      if (safeWorkspace) {
        const safeWorkingPath = resolveWithin(safeWorkspace, 'WORKING.md');
        mkdirSync(dirname(safeWorkingPath), { recursive: true });
        writeFileSync(safeWorkingPath, newContent, 'utf-8');
        savedToWorkspace = true;
      }
    } catch (err) {
      logger.warn({ err, agent: agent.name }, 'Failed to write WORKING.md to workspace');
    }

    // Update working memory
    const col = agentColumnName(agentId);
    const val = agentColumnValue(agentId);
    db.prepare(`
      UPDATE agents
      SET working_memory = ?, updated_at = ?
      WHERE ${col} = ? AND workspace_id = ?
    `).run(newContent, now, val, workspaceId);

    // Log activity
    db_helpers.logActivity(
      'agent_memory_updated',
      'agent',
      agent.id,
      agent.name,
      `Working memory ${append ? 'appended' : 'updated'} for agent ${agent.name}`,
      {
        content_length: newContent.length,
        append_mode: append || false,
        timestamp: now,
        saved_to_workspace: savedToWorkspace
      },
      workspaceId
    );

    return NextResponse.json({
      success: true,
      message: `Working memory ${append ? 'appended' : 'updated'} for ${agent.name}`,
      working_memory: newContent,
      saved_to_workspace: savedToWorkspace,
      updated_at: now,
      size: newContent.length
    });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents/[id]/memory error');
    return NextResponse.json({ error: 'Failed to update working memory' }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/[id]/memory - Clear agent's working memory
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const workspaceId = auth.user.workspace_id ?? 1;

    const agent = getAgentByIdOrName(db, agentId, workspaceId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const now = Math.floor(Date.now() / 1000);

    // Best effort: clear workspace WORKING.md if agent workspace is configured
    try {
      const agentConfig = agent.config ? JSON.parse(agent.config) : {};
      const candidates = getAgentWorkspaceCandidates(agentConfig, agent.name);
      const safeWorkspace = candidates[0];
      if (safeWorkspace) {
        const safeWorkingPath = resolveWithin(safeWorkspace, 'WORKING.md');
        mkdirSync(dirname(safeWorkingPath), { recursive: true });
        writeFileSync(safeWorkingPath, '', 'utf-8');
      }
    } catch (err) {
      logger.warn({ err, agent: agent.name }, 'Failed to clear WORKING.md in workspace');
    }

    // Clear working memory
    const col = agentColumnName(agentId);
    const val = agentColumnValue(agentId);
    db.prepare(`
      UPDATE agents
      SET working_memory = '', updated_at = ?
      WHERE ${col} = ? AND workspace_id = ?
    `).run(now, val, workspaceId);

    // Log activity
    db_helpers.logActivity(
      'agent_memory_cleared',
      'agent',
      agent.id,
      agent.name,
      `Working memory cleared for agent ${agent.name}`,
      { timestamp: now },
      workspaceId
    );

    return NextResponse.json({
      success: true,
      message: `Working memory cleared for ${agent.name}`,
      working_memory: '',
      updated_at: now
    });
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/agents/[id]/memory error');
    return NextResponse.json({ error: 'Failed to clear working memory' }, { status: 500 });
  }
}
