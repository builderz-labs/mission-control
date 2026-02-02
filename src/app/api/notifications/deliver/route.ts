import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Notification, db_helpers } from '@/lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * POST /api/notifications/deliver - Notification delivery daemon endpoint
 * 
 * Polls undelivered notifications and sends them to agent sessions
 * via OpenClaw sessions_send command
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDatabase();
    const body = await request.json();
    const { 
      agent_filter, // Optional: only deliver to specific agent
      limit = 50,   // Max notifications to process per call
      dry_run = false // Test mode - don't actually deliver
    } = body;
    
    // Get undelivered notifications
    let query = `
      SELECT n.*, a.session_key 
      FROM notifications n
      LEFT JOIN agents a ON n.recipient = a.name
      WHERE n.delivered_at IS NULL
    `;
    
    const params: any[] = [];
    
    if (agent_filter) {
      query += ' AND n.recipient = ?';
      params.push(agent_filter);
    }
    
    query += ' ORDER BY n.created_at ASC LIMIT ?';
    params.push(limit);
    
    const undeliveredNotifications = db.prepare(query).all(...params) as (Notification & { session_key?: string })[];
    
    if (undeliveredNotifications.length === 0) {
      return NextResponse.json({
        status: 'success',
        message: 'No undelivered notifications found',
        processed: 0,
        delivered: 0,
        errors: []
      });
    }
    
    let deliveredCount = 0;
    let errorCount = 0;
    const errors: any[] = [];
    const deliveryResults: any[] = [];
    
    for (const notification of undeliveredNotifications) {
      try {
        // Skip if agent doesn't have session key
        if (!notification.session_key) {
          errors.push({
            notification_id: notification.id,
            recipient: notification.recipient,
            error: 'Agent has no session key configured'
          });
          errorCount++;
          continue;
        }
        
        // Format message for delivery
        const message = formatNotificationMessage(notification);
        
        if (!dry_run) {
          // Send notification via OpenClaw sessions_send
          const command = `cd /home/ubuntu/clawd && openclaw gateway sessions_send --session "${notification.session_key}" --message "${message.replace(/"/g, '\\"')}"`;
          
          try {
            const { stdout, stderr } = await execAsync(command, { timeout: 10000 });
            
            if (stderr && stderr.includes('error')) {
              throw new Error(`OpenClaw error: ${stderr}`);
            }
            
            // Mark as delivered
            const now = Math.floor(Date.now() / 1000);
            db.prepare('UPDATE notifications SET delivered_at = ? WHERE id = ?')
              .run(now, notification.id);
            
            deliveredCount++;
            deliveryResults.push({
              notification_id: notification.id,
              recipient: notification.recipient,
              session_key: notification.session_key,
              delivered_at: now,
              status: 'delivered',
              stdout: stdout.substring(0, 200) // Truncate for storage
            });
            
            // Log successful delivery
            db_helpers.logActivity(
              'notification_delivered',
              'notification',
              notification.id,
              'system',
              `Notification delivered to ${notification.recipient}`,
              {
                notification_type: notification.type,
                session_key: notification.session_key,
                title: notification.title
              }
            );
          } catch (cmdError: any) {
            throw new Error(`Command failed: ${cmdError.message}`);
          }
        } else {
          // Dry run - just log what would be sent
          deliveryResults.push({
            notification_id: notification.id,
            recipient: notification.recipient,
            session_key: notification.session_key,
            status: 'dry_run',
            message: message
          });
          deliveredCount++;
        }
      } catch (error: any) {
        errorCount++;
        errors.push({
          notification_id: notification.id,
          recipient: notification.recipient,
          error: error.message
        });
        
        console.error(`Failed to deliver notification ${notification.id} to ${notification.recipient}:`, error);
      }
    }
    
    // Log delivery batch summary
    db_helpers.logActivity(
      'notification_delivery_batch',
      'system',
      0,
      'notification_daemon',
      `Processed ${undeliveredNotifications.length} notifications: ${deliveredCount} delivered, ${errorCount} failed`,
      {
        total_processed: undeliveredNotifications.length,
        delivered: deliveredCount,
        errors: errorCount,
        dry_run,
        agent_filter: agent_filter || null
      }
    );
    
    return NextResponse.json({
      status: 'success',
      message: `Processed ${undeliveredNotifications.length} notifications`,
      total_processed: undeliveredNotifications.length,
      delivered: deliveredCount,
      errors: errorCount,
      dry_run,
      delivery_results: deliveryResults,
      error_details: errors
    });
  } catch (error) {
    console.error('POST /api/notifications/deliver error:', error);
    return NextResponse.json({ error: 'Failed to deliver notifications' }, { status: 500 });
  }
}

/**
 * GET /api/notifications/deliver - Get delivery status and statistics
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const agent = searchParams.get('agent');
    
    // Get delivery statistics
    let baseQuery = 'SELECT COUNT(*) as count FROM notifications';
    let params: any[] = [];
    
    if (agent) {
      baseQuery += ' WHERE recipient = ?';
      params.push(agent);
    }
    
    const totalNotifications = db.prepare(baseQuery).get(...params) as { count: number };
    
    const undeliveredCount = db.prepare(
      baseQuery + (agent ? ' AND' : ' WHERE') + ' delivered_at IS NULL'
    ).get(...params) as { count: number };
    
    const deliveredCount = db.prepare(
      baseQuery + (agent ? ' AND' : ' WHERE') + ' delivered_at IS NOT NULL'
    ).get(...params) as { count: number };
    
    // Get recent delivery activity
    const recentDeliveries = db.prepare(`
      SELECT 
        recipient,
        type,
        title,
        delivered_at,
        created_at
      FROM notifications 
      WHERE delivered_at IS NOT NULL
      ${agent ? 'AND recipient = ?' : ''}
      ORDER BY delivered_at DESC 
      LIMIT 10
    `).all(...(agent ? [agent] : []));
    
    // Get agents with pending notifications
    const agentsPending = db.prepare(`
      SELECT 
        n.recipient,
        a.session_key,
        COUNT(*) as pending_count
      FROM notifications n
      LEFT JOIN agents a ON n.recipient = a.name
      WHERE n.delivered_at IS NULL
      GROUP BY n.recipient, a.session_key
      ORDER BY pending_count DESC
    `).all() as any[];
    
    return NextResponse.json({
      statistics: {
        total: totalNotifications.count,
        delivered: deliveredCount.count,
        undelivered: undeliveredCount.count,
        delivery_rate: totalNotifications.count > 0 ? 
          Math.round((deliveredCount.count / totalNotifications.count) * 100) : 0
      },
      agents_with_pending: agentsPending,
      recent_deliveries: recentDeliveries,
      agent_filter: agent
    });
  } catch (error) {
    console.error('GET /api/notifications/deliver error:', error);
    return NextResponse.json({ error: 'Failed to get delivery status' }, { status: 500 });
  }
}

/**
 * Format notification for delivery to agent session
 */
function formatNotificationMessage(notification: Notification): string {
  const timestamp = new Date(notification.created_at * 1000).toLocaleString();
  
  let message = `🔔 **${notification.title}**\n\n`;
  message += `${notification.message}\n\n`;
  
  if (notification.type === 'mention') {
    message += `📝 You were mentioned in a comment\n`;
  } else if (notification.type === 'assignment') {
    message += `📋 You have been assigned a new task\n`;
  } else if (notification.type === 'due_date') {
    message += `⏰ Task deadline approaching\n`;
  }
  
  if (notification.source_type && notification.source_id) {
    message += `🔗 Related ${notification.source_type} ID: ${notification.source_id}\n`;
  }
  
  message += `⏰ ${timestamp}`;
  
  return message;
}