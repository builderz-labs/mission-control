import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDatabase } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { logger } from '@/lib/logger';

// Parse raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');
    const eventType = request.headers.get('x-github-event');
    
    // 1. Signature Verification
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    
    if (!secret) {
      logger.error('GITHUB_WEBHOOK_SECRET is not configured');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    if (!signature) {
      return NextResponse.json({ error: 'No signature provided' }, { status: 401 });
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(rawBody).digest('hex');

    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
        logger.warn('GitHub Webhook signature mismatch');
        return NextResponse.json({ error: 'Signature mismatch' }, { status: 401 });
      }
    } catch (e) {
      return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 });
    }

    // 2. Parse Body
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // 3. Handle Pull Request Events
    if (eventType === 'pull_request') {
      const { action, pull_request, repository } = payload;
      
      // We care about PRs that are opened or have a review requested
      if (['opened', 'reopened', 'review_requested', 'ready_for_review'].includes(action)) {
        
        const prTitle = pull_request.title;
        const prUrl = pull_request.html_url;
        const prUser = pull_request.user.login;
        const repoName = repository.full_name;
        
        const db = getDatabase();
        const now = Math.floor(Date.now() / 1000);
        
        // Notify the 'operator' so it shows up in the UI for humans
        const recipient = 'operator'; 
        const workspaceId = 1; // Default workspace

        const notificationMsg = `GitHub PR ${action}: [${repoName}] ${prTitle} by @${prUser}`;
        const notificationTitle = `GitHub PR ${action}`;
        const sourceType = 'github_webhook';
        
        const dbResult = db.prepare(`
          INSERT INTO notifications (
            recipient, type, title, message, source_type, created_at, workspace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          recipient,
          'system',
          notificationTitle,
          notificationMsg,
          sourceType,
          now,
          workspaceId
        );

        // Broadcast to SSE so UI updates instantly
        eventBus.broadcast('notification.created', {
          id: dbResult.lastInsertRowid,
          recipient,
          type: 'system',
          title: notificationTitle,
          message: notificationMsg,
          source_type: sourceType,
          created_at: now
        });
        
        // Broadcast into the Recent Logs panel
        eventBus.broadcast('system.log', {
          id: `webhook-${Date.now()}`,
          timestamp: Date.now(),
          level: 'info',
          source: 'github_webhook',
          message: `Processed GitHub PR ${action} for ${repoName}#${pull_request.number}`
        });

        logger.info({ repo: repoName, pr: pull_request.number }, 'Processed GitHub PR webhook');
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error processing GitHub webhook');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
