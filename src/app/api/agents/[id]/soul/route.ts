import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from '@/lib/config';
import { resolveWithin } from '@/lib/paths';
import { getUserFromRequest, requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * GET /api/agents/[id]/soul - Get agent's SOUL content from workspace
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    let soulContent = '';
    let sourceLocation = 'database';

    // Try to read from workspace first
    if (agent.config) {
      try {
        const agentConfig = typeof agent.config === 'string'
          ? JSON.parse(agent.config)
          : agent.config;

        if (agentConfig.workspace) {
          const soulPath = join(agentConfig.workspace, 'soul.md');
          if (existsSync(soulPath)) {
            soulContent = readFileSync(soulPath, 'utf-8');
            sourceLocation = 'workspace';
          }
        }
      } catch (err) {
        logger.warn({ err }, `Failed to read SOUL from workspace for ${agent.name}, falling back to database`);
      }
    }

    // Fallback to database if file not found
    if (!soulContent && agent.soul_content) {
      soulContent = agent.soul_content;
    }

    const templatesPath = config.soulTemplatesDir;
    let availableTemplates: string[] = [];

    try {
      if (templatesPath && existsSync(templatesPath)) {
        const files = readdirSync(templatesPath);
        availableTemplates = files
          .filter(file => file.endsWith('.md'))
          .map(file => file.replace('.md', ''));
      }
    } catch (error) {
      logger.warn({ err: error }, 'Could not read soul templates directory');
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role
      },
      soul_content: soulContent,
      source: sourceLocation,
      available_templates: availableTemplates,
      updated_at: agent.updated_at
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/soul error');
    return NextResponse.json({ error: 'Failed to fetch SOUL content' }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/soul - Update agent's SOUL content and sync to workspace
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
    const { soul_content, template_name } = body;

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

    let newSoulContent = soul_content;

    // If template_name is provided, load from template
    if (template_name) {
      if (!config.soulTemplatesDir) {
        return NextResponse.json({ error: 'Templates directory not configured' }, { status: 500 });
      }
      let templatePath: string;
      try {
        templatePath = resolveWithin(config.soulTemplatesDir, `${template_name}.md`);
      } catch (pathError) {
        return NextResponse.json({ error: 'Invalid template name' }, { status: 400 });
      }

      try {
        if (existsSync(templatePath)) {
          const templateContent = readFileSync(templatePath, 'utf8');
          // Replace placeholders with agent info
          newSoulContent = templateContent
            .replace(/{{AGENT_NAME}}/g, agent.name)
            .replace(/{{AGENT_ROLE}}/g, agent.role)
            .replace(/{{TIMESTAMP}}/g, new Date().toISOString());
        } else {
          return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
      } catch (error) {
        logger.error({ err: error }, 'Error loading soul template');
        return NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
      }
    }

    const now = Math.floor(Date.now() / 1000);
    let savedToWorkspace = false;

    // Write to workspace file if configured
    if (agent.config) {
      try {
        const agentConfig = typeof agent.config === 'string'
          ? JSON.parse(agent.config)
          : agent.config;

        if (agentConfig.workspace) {
          const soulPath = join(agentConfig.workspace, 'soul.md');
          writeFileSync(soulPath, newSoulContent, 'utf-8');
          savedToWorkspace = true;
          logger.info({ agent: agent.name, path: soulPath }, 'SOUL content saved to workspace');
        }
      } catch (err) {
        logger.warn({ err, agent: agent.name }, 'Failed to write SOUL to workspace, saving to database only');
      }
    }

    // Always update database as backup
    const updateStmt = db.prepare(`
      UPDATE agents
      SET soul_content = ?, updated_at = ?
      WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ?
    `);

    updateStmt.run(newSoulContent, now, agentId);

    // Log activity
    db_helpers.logActivity(
      'agent_soul_updated',
      'agent',
      agent.id,
      getUserFromRequest(request)?.username || 'system',
      `SOUL content updated for agent ${agent.name}${template_name ? ` using template: ${template_name}` : ''}${savedToWorkspace ? ' (synced to workspace)' : ''}`,
      {
        template_used: template_name || null,
        content_length: newSoulContent ? newSoulContent.length : 0,
        previous_content_length: agent.soul_content ? agent.soul_content.length : 0,
        saved_to_workspace: savedToWorkspace
      }
    );

    return NextResponse.json({
      success: true,
      message: `SOUL content updated for ${agent.name}${savedToWorkspace ? ' (synced to workspace)' : ''}`,
      soul_content: newSoulContent,
      saved_to_workspace: savedToWorkspace,
      updated_at: now
    });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents/[id]/soul error');
    return NextResponse.json({ error: 'Failed to update SOUL content' }, { status: 500 });
  }
}

/**
 * GET /api/agents/[id]/soul/templates - Get available SOUL templates
 * Also handles loading specific template content
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const templateName = searchParams.get('template');
    
    const templatesPath = config.soulTemplatesDir;
    
    if (!templatesPath || !existsSync(templatesPath)) {
      return NextResponse.json({
        templates: [],
        message: 'Templates directory not found'
      });
    }
    
    if (templateName) {
      // Get specific template content
      let templatePath: string;
      try {
        templatePath = resolveWithin(templatesPath, `${templateName}.md`);
      } catch (pathError) {
        return NextResponse.json({ error: 'Invalid template name' }, { status: 400 });
      }
      
      if (!existsSync(templatePath)) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      
      const templateContent = readFileSync(templatePath, 'utf8');
      
      return NextResponse.json({
        template_name: templateName,
        content: templateContent
      });
    }
    
    // List all available templates
    const files = readdirSync(templatesPath);
    const templates = files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const name = file.replace('.md', '');
        const templatePath = join(templatesPath, file);
        const content = readFileSync(templatePath, 'utf8');
        
        // Extract first line as description
        const firstLine = content.split('\n')[0];
        const description = firstLine.startsWith('#') 
          ? firstLine.replace(/^#+\s*/, '') 
          : `${name} template`;
        
        return {
          name,
          description,
          size: content.length
        };
      });
    
    return NextResponse.json({ templates });
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/agents/[id]/soul error');
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}
