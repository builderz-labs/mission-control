import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getProjects } from '@/lib/cc-db';

/**
 * GET /api/projects - List all projects from control-center.db
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
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/projects error');
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}
