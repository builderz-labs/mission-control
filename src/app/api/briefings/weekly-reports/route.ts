import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { reportsRoot, generateWeeklyLandlordReports } from '@/lib/briefing-weekly-report';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';

/** Recursively list generated landlord report HTML files. */
function listReports(): Array<{ path: string; size: number; modified: number }> {
  const root = reportsRoot();
  if (!existsSync(root)) return [];
  const out: Array<{ path: string; size: number; modified: number }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith('.html')) {
        out.push({ path: relative(root, full), size: st.size, modified: Math.floor(st.mtimeMs / 1000) });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => b.modified - a.modified);
}

/**
 * GET /api/briefings/weekly-reports        → list report files
 * GET /api/briefings/weekly-reports?file=… → return that report's HTML
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const file = new URL(request.url).searchParams.get('file');
    if (!file) {
      return NextResponse.json({ reports: listReports(), root: reportsRoot() });
    }

    // Path-traversal guard: the resolved path must stay inside reportsRoot.
    const root = reportsRoot();
    const target = resolve(root, file);
    const rel = relative(root, target);
    if (isAbsolute(rel) || rel.startsWith('..') || !target.endsWith('.html') || !existsSync(target)) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    return new NextResponse(readFileSync(target, 'utf-8'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/briefings/weekly-reports error');
    return NextResponse.json({ error: 'Failed to list reports' }, { status: 500 });
  }
}

/** POST /api/briefings/weekly-reports — generate reports now (manual trigger). */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const result = generateWeeklyLandlordReports(db, { workspaceId });
    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, 'POST /api/briefings/weekly-reports error');
    return NextResponse.json({ error: 'Failed to generate reports' }, { status: 500 });
  }
}
