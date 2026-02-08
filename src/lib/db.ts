import Database from 'better-sqlite3';
import { dirname } from 'path';
import { config, ensureDirExists } from './config';
import { runMigrations } from './migrations';
import { eventBus } from './event-bus';
import { seedAdminUser } from './auth';

// Database file location
const DB_PATH = config.dbPath;

// Global database instance
let db: Database.Database | null = null;

/**
 * Get or create database connection
 */
export function getDatabase(): Database.Database {
  if (!db) {
    ensureDirExists(dirname(DB_PATH));
    db = new Database(DB_PATH);
    
    // Enable WAL mode for better concurrent access
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 1000');
    
    // Initialize schema if needed
    initializeSchema();
  }
  
  return db;
}

/**
 * Initialize database schema via migrations
 */
let webhookListenerInitialized = false;

function initializeSchema() {
  if (!db) return;
  try {
    runMigrations(db);
    seedAdminUser();

    // Initialize webhook event listener (once)
    if (!webhookListenerInitialized) {
      webhookListenerInitialized = true;
      import('./webhooks').then(({ initWebhookListener }) => {
        initWebhookListener();
      }).catch(() => {
        // Silent - webhooks are optional
      });
    }

    console.log('Database migrations applied successfully');
  } catch (error) {
    console.error('Failed to apply database migrations:', error);
    throw error;
  }
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

// Type definitions for database entities
export interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to?: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  due_date?: number;
  estimated_hours?: number;
  actual_hours?: number;
  tags?: string; // JSON string
  metadata?: string; // JSON string
}

export interface Agent {
  id: number;
  name: string;
  role: string;
  session_key?: string;
  soul_content?: string;
  status: 'offline' | 'idle' | 'busy' | 'error';
  last_seen?: number;
  last_activity?: string;
  created_at: number;
  updated_at: number;
  config?: string; // JSON string
}

export interface Comment {
  id: number;
  task_id: number;
  author: string;
  content: string;
  created_at: number;
  parent_id?: number;
  mentions?: string; // JSON string
}

export interface Activity {
  id: number;
  type: string;
  entity_type: string;
  entity_id: number;
  actor: string;
  description: string;
  data?: string; // JSON string
  created_at: number;
}

export interface Message {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent?: string;
  content: string;
  message_type: string;
  metadata?: string; // JSON string
  read_at?: number;
  created_at: number;
}

export interface Notification {
  id: number;
  recipient: string;
  type: string;
  title: string;
  message: string;
  source_type?: string;
  source_id?: number;
  read_at?: number;
  delivered_at?: number;
  created_at: number;
}

// Database helper functions
export const db_helpers = {
  /**
   * Log an activity to the activity stream
   */
  logActivity: (type: string, entity_type: string, entity_id: number, actor: string, description: string, data?: any) => {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO activities (type, entity_type, entity_id, actor, description, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(type, entity_type, entity_id, actor, description, data ? JSON.stringify(data) : null);

    const activityPayload = {
      id: result.lastInsertRowid,
      type,
      entity_type,
      entity_id,
      actor,
      description,
      data: data || null,
      created_at: Math.floor(Date.now() / 1000),
    };

    // Broadcast to SSE clients (webhooks listen here too)
    eventBus.broadcast('activity.created', activityPayload);
  },

  /**
   * Create notification for @mentions
   */
  createNotification: (recipient: string, type: string, title: string, message: string, source_type?: string, source_id?: number) => {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO notifications (recipient, type, title, message, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(recipient, type, title, message, source_type, source_id);

    const notificationPayload = {
      id: result.lastInsertRowid,
      recipient,
      type,
      title,
      message,
      source_type: source_type || null,
      source_id: source_id || null,
      created_at: Math.floor(Date.now() / 1000),
    };

    // Broadcast to SSE clients (webhooks listen here too)
    eventBus.broadcast('notification.created', notificationPayload);

    return result;
  },

  /**
   * Parse @mentions from text
   */
  parseMentions: (text: string): string[] => {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    
    return mentions;
  },

  /**
   * Update agent status and last seen
   */
  updateAgentStatus: (agentName: string, status: Agent['status'], activity?: string) => {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);

    // Get agent ID before update
    const agent = db.prepare('SELECT id FROM agents WHERE name = ?').get(agentName) as { id: number } | undefined;

    const stmt = db.prepare(`
      UPDATE agents
      SET status = ?, last_seen = ?, last_activity = ?, updated_at = ?
      WHERE name = ?
    `);
    stmt.run(status, now, activity, now, agentName);

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
    db_helpers.logActivity('agent_status_change', 'agent', agent?.id || 0, agentName, `Agent status changed to ${status}`, { status, activity });
  },

  /**
   * Get recent activities for feed
   */
  getRecentActivities: (limit: number = 50): Activity[] => {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM activities 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    
    return stmt.all(limit) as Activity[];
  },

  /**
   * Get unread notifications for recipient
   */
  getUnreadNotifications: (recipient: string): Notification[] => {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM notifications 
      WHERE recipient = ? AND read_at IS NULL
      ORDER BY created_at DESC
    `);
    
    return stmt.all(recipient) as Notification[];
  },

  /**
   * Mark notification as read
   */
  markNotificationRead: (notificationId: number) => {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE notifications 
      SET read_at = ?
      WHERE id = ?
    `);
    
    stmt.run(Math.floor(Date.now() / 1000), notificationId);
  },

  /**
   * Ensure an agent is subscribed to a task
   */
  ensureTaskSubscription: (taskId: number, agentName: string) => {
    if (!agentName) return;
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO task_subscriptions (task_id, agent_name)
      VALUES (?, ?)
    `);
    stmt.run(taskId, agentName);
  },

  /**
   * Get subscribers for a task
   */
  getTaskSubscribers: (taskId: number): string[] => {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT agent_name FROM task_subscriptions WHERE task_id = ?
    `).all(taskId) as Array<{ agent_name: string }>;
    return rows.map((row) => row.agent_name);
  }
};

/**
 * Log a security/admin audit event
 */
export function logAuditEvent(event: {
  action: string
  actor: string
  actor_id?: number
  target_type?: string
  target_id?: number
  detail?: any
  ip_address?: string
  user_agent?: string
}) {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO audit_log (action, actor, actor_id, target_type, target_id, detail, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.action,
    event.actor,
    event.actor_id ?? null,
    event.target_type ?? null,
    event.target_id ?? null,
    event.detail ? JSON.stringify(event.detail) : null,
    event.ip_address ?? null,
    event.user_agent ?? null,
  )

  // Broadcast audit events (webhooks listen here too)
  const securityEvents = ['login_failed', 'user_created', 'user_deleted', 'password_change']
  if (securityEvents.includes(event.action)) {
    eventBus.broadcast('audit.security', {
      action: event.action,
      actor: event.actor,
      target_type: event.target_type ?? null,
      target_id: event.target_id ?? null,
      timestamp: Math.floor(Date.now() / 1000),
    })
  }
}

// Initialize database on module load
if (typeof window === 'undefined') { // Only run on server side
  try {
    getDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// Cleanup on process exit
process.on('exit', closeDatabase);
process.on('SIGINT', closeDatabase);
process.on('SIGTERM', closeDatabase);
