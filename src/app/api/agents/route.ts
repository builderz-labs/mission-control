import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Agent, db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { getTemplate, buildAgentConfig } from '@/lib/agent-templates';
import { writeAgentToConfig } from '@/lib/agent-sync';
import { logAuditEvent } from '@/lib/db';
import { getUserFromRequest, requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { validateBody, createAgentSchema } from '@/lib/validation';

/**
 * GET /api/agents - List all agents with optional filtering
 * Query params: status, role, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const status = searchParams.get('status');
    const role = searchParams.get('role');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    
    // Build dynamic query
    let query = 'SELECT * FROM agents WHERE 1=1';
    const params: any[] = [];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const stmt = db.prepare(query);
    const agents = stmt.all(...params) as Agent[];
    
    // Parse JSON config field
    const agentsWithParsedData = agents.map(agent => ({
      ...agent,
      config: agent.config ? JSON.parse(agent.config) : {}
    }));
    
    // Get task counts for each agent (prepare once, reuse per agent)
    const taskCountStmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
      FROM tasks
      WHERE assigned_to = ?
    `);

    const agentsWithStats = agentsWithParsedData.map(agent => {
      const taskStats = taskCountStmt.get(agent.name) as any;

      return {
        ...agent,
        taskStats: {
          total: taskStats.total || 0,
          assigned: taskStats.assigned || 0,
          in_progress: taskStats.in_progress || 0,
          completed: taskStats.completed || 0
        }
      };
    });
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM agents WHERE 1=1';
    const countParams: any[] = [];
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    if (role) {
      countQuery += ' AND role = ?';
      countParams.push(role);
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number };

    return NextResponse.json({
      agents: agentsWithStats,
      total: countRow.total,
      page: Math.floor(offset / limit) + 1,
      limit
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents error');
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

/**
 * POST /api/agents - Create a new agent
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const validated = await validateBody(request, createAgentSchema);
    if ('error' in validated) return validated.error;
    const body = validated.data;

    const {
      name,
      role,
      session_key,
      soul_content,
      status = 'offline',
      config = {},
      template,
      gateway_config,
      write_to_gateway
    } = body;

    // Resolve template if specified
    let finalRole = role;
    let finalConfig: Record<string, any> = config as Record<string, any>;
    if (template) {
      const tpl = getTemplate(template);
      if (tpl) {
        const builtConfig = buildAgentConfig(tpl, (gateway_config || {}) as any);
        finalConfig = { ...builtConfig, ...finalConfig };
        if (!finalRole) finalRole = tpl.config.identity?.theme || tpl.type;
      }
    } else if (gateway_config) {
      finalConfig = { ...finalConfig, ...(gateway_config as Record<string, any>) };
    }

    if (!name || !finalRole) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    // Check if agent name already exists
    const existingAgent = db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
    if (existingAgent) {
      return NextResponse.json({ error: 'Agent name already exists' }, { status: 409 });
    }
    
    const now = Math.floor(Date.now() / 1000);
    
    const stmt = db.prepare(`
      INSERT INTO agents (
        name, role, session_key, soul_content, status, 
        created_at, updated_at, config
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      name,
      finalRole,
      session_key,
      soul_content,
      status,
      now,
      now,
      JSON.stringify(finalConfig)
    );
    
    const agentId = result.lastInsertRowid as number;
    
    // Log activity
    db_helpers.logActivity(
      'agent_created',
      'agent',
      agentId,
      getUserFromRequest(request)?.username || 'system',
      `Created agent: ${name} (${finalRole})${template ? ` from template: ${template}` : ''}`,
      {
        name,
        role: finalRole,
        status,
        session_key,
        template: template || null
      }
    );
    
    // Fetch the created agent
    const createdAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Agent;
    const parsedAgent = {
      ...createdAgent,
      config: JSON.parse(createdAgent.config || '{}'),
      taskStats: { total: 0, assigned: 0, in_progress: 0, completed: 0 }
    };

    // Broadcast to SSE clients
    eventBus.broadcast('agent.created', parsedAgent);

    // Write to gateway config if requested
    if (write_to_gateway && finalConfig) {
      try {
        const openclawId = (name || 'agent').toLowerCase().replace(/\s+/g, '-');
        await writeAgentToConfig({
          id: openclawId,
          name,
          ...(finalConfig.model && { model: finalConfig.model }),
          ...(finalConfig.identity && { identity: finalConfig.identity }),
          ...(finalConfig.sandbox && { sandbox: finalConfig.sandbox }),
          ...(finalConfig.tools && { tools: finalConfig.tools }),
          ...(finalConfig.subagents && { subagents: finalConfig.subagents }),
          ...(finalConfig.memorySearch && { memorySearch: finalConfig.memorySearch }),
        });

        const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
        logAuditEvent({
          action: 'agent_gateway_create',
          actor: getUserFromRequest(request)?.username || 'system',
          target_type: 'agent',
          target_id: agentId as number,
          detail: { name, openclaw_id: openclawId, template: template || null },
          ip_address: ipAddress,
        });
      } catch (gwErr: any) {
        logger.error({ err: gwErr }, 'Gateway write-back failed');
        return NextResponse.json({ 
          agent: parsedAgent,
          warning: `Agent created in MC but gateway write failed: ${gwErr.message}`
        }, { status: 201 });
      }
    }

    return NextResponse.json({ agent: parsedAgent }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents error');
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}

/**
 * PUT /api/agents - Update agent status (bulk operation for status updates)
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const body = await request.json();

    // Handle single agent update or bulk updates
    if (body.name) {
      // Single agent update
      const { name, status, last_activity, config, session_key, soul_content, role } = body;
      
      const agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as Agent;
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      
      const now = Math.floor(Date.now() / 1000);
      
      // Build dynamic update query
      const fieldsToUpdate = [];
      const params: any[] = [];
      
      if (status !== undefined) {
        fieldsToUpdate.push('status = ?');
        params.push(status);
        
        fieldsToUpdate.push('last_seen = ?');
        params.push(now);
      }
      
      if (last_activity !== undefined) {
        fieldsToUpdate.push('last_activity = ?');
        params.push(last_activity);
      }
      
      if (config !== undefined) {
        fieldsToUpdate.push('config = ?');
        params.push(JSON.stringify(config));
      }
      
      if (session_key !== undefined) {
        fieldsToUpdate.push('session_key = ?');
        params.push(session_key);
      }
      
      if (soul_content !== undefined) {
        fieldsToUpdate.push('soul_content = ?');
        params.push(soul_content);
      }
      
      if (role !== undefined) {
        fieldsToUpdate.push('role = ?');
        params.push(role);
      }
      
      fieldsToUpdate.push('updated_at = ?');
      params.push(now);
      params.push(name);
      
      if (fieldsToUpdate.length === 1) { // Only updated_at
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }
      
      const stmt = db.prepare(`
        UPDATE agents 
        SET ${fieldsToUpdate.join(', ')}
        WHERE name = ?
      `);
      
      stmt.run(...params);
      
      // Log status change if status was updated
      if (status !== undefined && status !== agent.status) {
        db_helpers.logActivity(
          'agent_status_change',
          'agent',
          agent.id,
          name,
          `Agent status changed from ${agent.status} to ${status}`,
          {
            oldStatus: agent.status,
            newStatus: status,
            last_activity
          }
        );
      }

      // Broadcast update to SSE clients
      eventBus.broadcast('agent.updated', {
        id: agent.id,
        name,
        ...(status !== undefined && { status }),
        ...(last_activity !== undefined && { last_activity }),
        ...(role !== undefined && { role }),
        updated_at: now,
      });

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
    }
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents error');
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}