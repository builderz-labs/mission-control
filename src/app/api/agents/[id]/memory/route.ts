import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';

/**
 * GET /api/agents/[id]/memory - Get agent's working memory
 * 
 * Working memory is stored as WORKING.md content in the database
 * Each agent has their own working memory space for temporary notes
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    
    // Get agent by ID or name
    let agent;
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentId);
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentId));
    }
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    
    // Check if agent has a working_memory column, if not create it
    const columns = db.prepare("PRAGMA table_info(agents)").all();
    const hasWorkingMemory = columns.some((col: any) => col.name === 'working_memory');
    
    if (!hasWorkingMemory) {
      // Add working_memory column to agents table
      db.exec("ALTER TABLE agents ADD COLUMN working_memory TEXT DEFAULT ''");
    }
    
    // Get working memory content
    const memoryStmt = db.prepare(`SELECT working_memory FROM agents WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ?`);
    const result = memoryStmt.get(agentId) as any;
    
    const workingMemory = result?.working_memory || '';
    
    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role
      },
      working_memory: workingMemory,
      updated_at: agent.updated_at,
      size: workingMemory.length
    });
  } catch (error) {
    console.error('GET /api/agents/[id]/memory error:', error);
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
  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const body = await request.json();
    const { working_memory, append } = body;
    
    // Get agent by ID or name
    let agent;
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentId);
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentId));
    }
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    
    // Check if agent has a working_memory column, if not create it
    const columns = db.prepare("PRAGMA table_info(agents)").all();
    const hasWorkingMemory = columns.some((col: any) => col.name === 'working_memory');
    
    if (!hasWorkingMemory) {
      db.exec("ALTER TABLE agents ADD COLUMN working_memory TEXT DEFAULT ''");
    }
    
    let newContent = working_memory || '';
    
    // Handle append mode
    if (append) {
      const currentStmt = db.prepare(`SELECT working_memory FROM agents WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ?`);
      const current = currentStmt.get(agentId) as any;
      const currentContent = current?.working_memory || '';
      
      // Add timestamp and append
      const timestamp = new Date().toISOString();
      newContent = currentContent + (currentContent ? '\n\n' : '') + 
                   `## ${timestamp}\n${working_memory}`;
    }
    
    const now = Math.floor(Date.now() / 1000);
    
    // Update working memory
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
        timestamp: now
      }
    );
    
    return NextResponse.json({
      success: true,
      message: `Working memory ${append ? 'appended' : 'updated'} for ${agent.name}`,
      working_memory: newContent,
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
  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    
    // Get agent by ID or name
    let agent;
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentId);
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentId));
    }
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    
    const now = Math.floor(Date.now() / 1000);
    
    // Clear working memory
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