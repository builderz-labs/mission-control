// Reusable query helpers consumed by route handlers and server actions.
// These are grouped as db_helpers to mirror the original API surface exactly.
import { eventBus } from '../event-bus';
import { parseMentions as parseMentionTokens } from '../mentions';
import { getDatabase } from './connection';
import type { Activity, Agent, Notification } from './types';

export const db_helpers = {
  /**
   * Log an activity to the activity stream
   */
  logActivity: (
    type: string,
    entity_type: string,
    entity_id: number,
    actor: string,
    description: string,
    data?: unknown,
    workspaceId: number = 1
  ): void => {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO activities (type, entity_type, entity_id, actor, description, data, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(type, entity_type, entity_id, actor, description, data ? JSON.stringify(data) : null, workspaceId);

    const activityPayload = {
      id: result.lastInsertRowid,
      type,
      entity_type,
      entity_id,
      actor,
      description,
      data: data || null,
      created_at: Math.floor(Date.now() / 1000),
      workspace_id: workspaceId,
    };

    // Broadcast to SSE clients (webhooks listen here too)
    eventBus.broadcast('activity.created', activityPayload);
  },

  /**
   * Create notification for @mentions
   */
  createNotification: (
    recipient: string,
    type: string,
    title: string,
    message: string,
    source_type?: string,
    source_id?: number,
    workspaceId: number = 1
  ) => {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO notifications (recipient, type, title, message, source_type, source_id, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(recipient, type, title, message, source_type, source_id, workspaceId);

    const notificationPayload = {
      id: result.lastInsertRowid,
      recipient,
      type,
      title,
      message,
      source_type: source_type || null,
      source_id: source_id || null,
      created_at: Math.floor(Date.now() / 1000),
      workspace_id: workspaceId,
    };

    // Broadcast to SSE clients (webhooks listen here too)
    eventBus.broadcast('notification.created', notificationPayload);

    return result;
  },

  /**
   * Parse @mentions from text
   */
  parseMentions: (text: string): string[] => {
    return parseMentionTokens(text);
  },

  /**
   * Update agent status and last seen
   */
  updateAgentStatus: (agentName: string, status: Agent['status'], activity?: string, workspaceId: number = 1): void => {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);

    // Get agent ID before update
    const agent = db.prepare('SELECT id FROM agents WHERE name = ? AND workspace_id = ?').get(agentName, workspaceId) as { id: number } | undefined;

    const stmt = db.prepare(`
      UPDATE agents
      SET status = ?, last_seen = ?, last_activity = ?, updated_at = ?
      WHERE name = ? AND workspace_id = ?
    `);
    stmt.run(status, now, activity, now, agentName, workspaceId);

    // Broadcast agent status change to SSE clients
    if (agent) {
      eventBus.broadcast('agent.status_changed', {
        id: agent.id,
        name: agentName,
        status,
        last_seen: now,
        last_activity: activity || null,
      });
    }

    // Log the status change
    db_helpers.logActivity('agent_status_change', 'agent', agent?.id || 0, agentName, `Agent status changed to ${status}`, { status, activity }, workspaceId);
  },

  /**
   * Get recent activities for feed
   */
  getRecentActivities: (limit: number = 50): Activity[] => {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, type, entity_type, entity_id, actor, description, data, created_at, workspace_id
      FROM activities
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(limit) as Activity[];
  },

  /**
   * Get unread notifications for recipient
   */
  getUnreadNotifications: (recipient: string, workspaceId: number = 1): Notification[] => {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, recipient, type, title, message, source_type, source_id, read_at, delivered_at, created_at, workspace_id
      FROM notifications
      WHERE recipient = ? AND read_at IS NULL AND workspace_id = ?
      ORDER BY created_at DESC
    `);

    return stmt.all(recipient, workspaceId) as Notification[];
  },

  /**
   * Mark notification as read
   */
  markNotificationRead: (notificationId: number, workspaceId: number = 1): void => {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE notifications
      SET read_at = ?
      WHERE id = ? AND workspace_id = ?
    `);

    stmt.run(Math.floor(Date.now() / 1000), notificationId, workspaceId);
  },

  /**
   * Ensure an agent is subscribed to a task
   */
  ensureTaskSubscription: (taskId: number, agentName: string, workspaceId: number = 1): void => {
    if (!agentName) return;
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO task_subscriptions (task_id, agent_name)
      SELECT t.id, ?
      FROM tasks t
      WHERE t.id = ? AND t.workspace_id = ?
    `);
    stmt.run(agentName, taskId, workspaceId);
  },

  /**
   * Get subscribers for a task
   */
  getTaskSubscribers: (taskId: number, workspaceId: number = 1): string[] => {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT ts.agent_name
      FROM task_subscriptions ts
      JOIN tasks t ON t.id = ts.task_id
      WHERE ts.task_id = ? AND t.workspace_id = ?
    `).all(taskId, workspaceId) as Array<{ agent_name: string }>;
    return rows.map((row) => row.agent_name);
  }
};
