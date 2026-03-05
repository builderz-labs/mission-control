import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getAgentWorkspace, readWorkspaceFile, writeWorkspaceFile, listMemoryFiles } from '@/lib/agent-workspace';

/**
 * GET /api/agents/[id]/memory - Get agent's working memory
 * Reads from disk first ({workspace}/MEMORY.md), falls back to DB.
 * Also includes a list of daily memory files from {workspace}/memory/
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

    // Get agent by ID or name
    let agent: any;
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentId);
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentId));
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Try disk first
    let workingMemory: string | null = null;
    let source: 'disk' | 'db' = 'db';
    let dailyFiles: ReturnType<typeof listMemoryFiles> = [];
    const workspace = getAgentWorkspace(agentId);

    if (workspace) {
      const diskContent = readWorkspaceFile(workspace, 'MEMORY.md');
      if (diskContent !== null) {
        workingMemory = diskContent;
        source = 'disk';
      }
      dailyFiles = listMemoryFiles(workspace);
    }

    // Fall back to DB
    if (workingMemory === null) {
      // Check if column exists
      const columns = db.prepare("PRAGMA table_info(agents)").all();
      const hasWorkingMemory = columns.some((col: any) => col.name === 'working_memory');
      if (hasWorkingMemory) {
        const memoryStmt = db.prepare(`SELECT working_memory FROM agents WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ?`);
        const result = memoryStmt.get(agentId) as any;
        workingMemory = result?.working_memory || '';
      } else {
        workingMemory = '';
      }
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role
      },
      working_memory: workingMemory,
      source,
      workspace: workspace || null,
      daily_files: dailyFiles,
      updated_at: agent.updated_at,
      size: (workingMemory || '').length
    });
  } catch (error) {
    console.error('GET /api/agents/[id]/memory error:', error);
    return NextResponse.json({ error: 'Failed to fetch working memory' }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/memory - Update agent's working memory
 * Writes to disk first ({workspace}/MEMORY.md), then updates DB cache.
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
    const body = await request.json();
    const { working_memory, append } = body;

    // Get agent by ID or name
    let agent: any;
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentId);
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentId));
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Ensure column exists
    const columns = db.prepare("PRAGMA table_info(agents)").all();
    const hasWorkingMemory = columns.some((col: any) => col.name === 'working_memory');
    if (!hasWorkingMemory) {
      db.exec("ALTER TABLE agents ADD COLUMN working_memory TEXT DEFAULT ''");
    }

    let newContent = working_memory || '';

    // Handle append mode — read current from disk or DB
    if (append) {
      let currentContent = '';
      const workspace = getAgentWorkspace(agentId);
      if (workspace) {
        currentContent = readWorkspaceFile(workspace, 'MEMORY.md') || '';
      }
      if (!currentContent) {
        const currentStmt = db.prepare(`SELECT working_memory FROM agents WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ?`);
        const current = currentStmt.get(agentId) as any;
        currentContent = current?.working_memory || '';
      }

      const timestamp = new Date().toISOString();
      newContent = currentContent + (currentContent ? '\n\n' : '') +
                   `## ${timestamp}\n${working_memory}`;
    }

    // Write to disk first
    let wroteToFile = false;
    const workspace = getAgentWorkspace(agentId);
    if (workspace) {
      try {
        writeWorkspaceFile(workspace, 'MEMORY.md', newContent);
        wroteToFile = true;
      } catch (err) {
        console.error('Failed to write MEMORY.md to disk:', err);
      }
    }

    const now = Math.floor(Date.now() / 1000);

    // Update DB cache
    const updateStmt = db.prepare(`
      UPDATE agents
      SET working_memory = ?, updated_at = ?
      WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ?
    `);

    updateStmt.run(newContent, now, agentId);

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
        wrote_to_disk: wroteToFile,
        timestamp: now
      }
    );

    return NextResponse.json({
      success: true,
      message: `Working memory ${append ? 'appended' : 'updated'} for ${agent.name}`,
      working_memory: newContent,
      source: wroteToFile ? 'disk' : 'db',
      updated_at: now,
      size: newContent.length
    });
  } catch (error) {
    console.error('PUT /api/agents/[id]/memory error:', error);
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

    // Get agent by ID or name
    let agent: any;
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentId);
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentId));
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Clear on disk too
    const workspace = getAgentWorkspace(agentId);
    if (workspace) {
      try {
        writeWorkspaceFile(workspace, 'MEMORY.md', '');
      } catch (err) {
        console.error('Failed to clear MEMORY.md on disk:', err);
      }
    }

    const now = Math.floor(Date.now() / 1000);

    // Clear in DB
    const updateStmt = db.prepare(`
      UPDATE agents
      SET working_memory = '', updated_at = ?
      WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ?
    `);

    updateStmt.run(now, agentId);

    // Log activity
    db_helpers.logActivity(
      'agent_memory_cleared',
      'agent',
      agent.id,
      agent.name,
      `Working memory cleared for agent ${agent.name}`,
      { timestamp: now }
    );

    return NextResponse.json({
      success: true,
      message: `Working memory cleared for ${agent.name}`,
      working_memory: '',
      updated_at: now
    });
  } catch (error) {
    console.error('DELETE /api/agents/[id]/memory error:', error);
    return NextResponse.json({ error: 'Failed to clear working memory' }, { status: 500 });
  }
}
