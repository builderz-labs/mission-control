import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getProjects, createProject, getProjectTaskCount, getProjectLastActivity } from '@/lib/cc-db';

/**
 * GET /api/projects - List all projects from control-center.db with task counts and last activity
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const projects = getProjects();
    return NextResponse.json({
      projects: projects.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        emoji: p.emoji,
        repo_url: p.repo_url,
        local_path: p.local_path,
        taskCount: getProjectTaskCount(p.id),
        lastActivity: getProjectLastActivity(p.id),
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/projects error');
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

/**
 * POST /api/projects - Create a new project manually (without AI generation)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const { title, description, emoji, repo_url, local_path } = body;

    // Validate required field
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'Title is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const project = createProject(
      title.trim(),
      description || '',
      emoji || '📁',
      repo_url || '',
      local_path || ''
    );

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        emoji: project.emoji,
        repo_url: project.repo_url,
        local_path: project.local_path,
        taskCount: 0,
        lastActivity: 0,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/projects error');
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
