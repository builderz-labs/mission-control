import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { syncClaudeSessions } from '@/lib/claude-sessions';
import { syncGitHealth, trackAllProjects } from '@/lib/project-tracker';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { command, args } = await request.json();

    switch (command) {
      case 'sync-projects':
        await Promise.all([syncClaudeSessions(), syncGitHealth()]);
        trackAllProjects();
        return NextResponse.json({ status: 'success', message: 'Fleet synchronization complete' });

      case 'kill-all':
        // Surgical kill for local Claude processes
        try {
          // Attempt to kill Claude Code processes specifically
          await execAsync('pkill -f "claude"'); 
          logger.info('Broadcasted SIGTERM to all Claude processes');
          return NextResponse.json({ status: 'success', message: 'Termination signals broadcasted' });
        } catch (e) {
          return NextResponse.json({ status: 'warning', message: 'No active processes found to terminate' });
        }

      case 'status-report':
        const projects = trackAllProjects();
        return NextResponse.json({ 
          status: 'success', 
          message: 'Status report generated', 
          data: { projectCount: projects.length } 
        });

      case 'policy-enforce':
        const { sessionId, reason } = await request.json();
        if (!sessionId) return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
        
        try {
          // In a real scenario, we'd find the PID. For now, we broadcast pkill or specific target.
          // Since we are surgical, we might use pgrep or just trust the global broadcast for criticals.
          await execAsync(`pkill -f "${sessionId}"`); 
          logger.warn({ sessionId, reason }, 'Policy Enforcement: Terminated session');
          return NextResponse.json({ status: 'success', message: `Enforced policy on session: ${reason}` });
        } catch (e) {
          return NextResponse.json({ status: 'warning', message: 'Target session already terminated or not found' });
        }

      default:
        return NextResponse.json({ error: 'Unknown command' }, { status: 400 });
    }
  } catch (error: any) {
    logger.error({ err: error }, 'Command API error');
    return NextResponse.json({ error: 'Failed to execute command', details: error.message }, { status: 500 });
  }
}
