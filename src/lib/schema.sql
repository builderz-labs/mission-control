-- Mission Control Phase 2 Database Schema
-- Created: 2026-02-02 for Ralph Wiggum Loop pattern

-- Tasks Table - Core Kanban task management
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'inbox', -- inbox, assigned, in_progress, review, done
    priority TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, urgent
    assigned_to TEXT, -- agent session key
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    due_date INTEGER, -- Unix timestamp
    estimated_hours INTEGER,
    actual_hours INTEGER,
    tags TEXT, -- JSON array of tags
    metadata TEXT -- JSON for additional data
);

-- Agents Table - Squad management
CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL, -- e.g., "researcher", "developer", "analyst"
    session_key TEXT UNIQUE, -- ClawdBot session identifier
    soul_content TEXT, -- SOUL.md content for this agent
    status TEXT NOT NULL DEFAULT 'offline', -- offline, idle, busy, error
    last_seen INTEGER, -- Unix timestamp
    last_activity TEXT, -- Description of last activity
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    config TEXT -- JSON for agent-specific configuration
);

-- Comments Table - Task discussion threads
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    author TEXT NOT NULL, -- agent name or "system"
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    parent_id INTEGER, -- For nested comments/replies
    mentions TEXT, -- JSON array of @mentioned agents
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL
);

-- Activities Table - Real-time activity stream
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- task_created, task_updated, comment_added, agent_status_change, etc.
    entity_type TEXT NOT NULL, -- task, agent, comment
    entity_id INTEGER NOT NULL,
    actor TEXT NOT NULL, -- who performed the action
    description TEXT NOT NULL, -- human-readable description
    data TEXT, -- JSON with additional context
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Notifications Table - @mentions and alerts
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL, -- agent name
    type TEXT NOT NULL, -- mention, assignment, status_change, due_date
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    source_type TEXT, -- task, comment, agent
    source_id INTEGER,
    read_at INTEGER, -- Unix timestamp when marked as read
    delivered_at INTEGER, -- Unix timestamp when delivered to agent
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_task_id ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_agents_session_key ON agents(session_key);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- Sample Data for Development
INSERT OR IGNORE INTO agents (name, role, session_key, soul_content, status) VALUES
('Jarv', 'coordinator', 'main', 'Primary AI coordinator and task manager', 'idle'),
('Research-Bot', 'researcher', null, 'Specialized in web research and data analysis', 'offline'),
('Code-Bot', 'developer', null, 'Handles coding tasks and technical implementation', 'offline');

INSERT OR IGNORE INTO tasks (title, description, status, priority, created_by) VALUES
('Setup Mission Control Phase 2', 'Implement Kanban task board, activity feed, and agent management', 'in_progress', 'high', 'system'),
('Test Agent Communication', 'Verify @mention system and notification delivery', 'inbox', 'medium', 'system'),
('Daily Standup Automation', 'Create automated daily standup report generation', 'inbox', 'low', 'system');