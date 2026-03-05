import { readFileSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'

type Migration = {
  id: string
  up: (db: Database.Database) => void
}

const migrations: Migration[] = [
  {
    id: '001_init',
    up: (db) => {
      const schemaPath = join(process.cwd(), 'src', 'lib', 'schema.sql')
      const schema = readFileSync(schemaPath, 'utf8')
      const statements = schema.split(';').filter((stmt) => stmt.trim())
      db.transaction(() => {
        for (const statement of statements) {
          db.exec(statement.trim())
        }
      })()
    }
  },
  {
    id: '002_quality_reviews',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quality_reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          reviewer TEXT NOT NULL,
          status TEXT NOT NULL,
          notes TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_task_id ON quality_reviews(task_id);
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_reviewer ON quality_reviews(reviewer);
      `)
    }
  },
  {
    id: '003_quality_review_status_backfill',
    up: (db) => {
      // Convert existing review tasks to quality_review to enforce the gate
      db.exec(`
        UPDATE tasks
        SET status = 'quality_review'
        WHERE status = 'review';
      `)
    }
  },
  {
    id: '004_messages',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          from_agent TEXT NOT NULL,
          to_agent TEXT,
          content TEXT NOT NULL,
          message_type TEXT DEFAULT 'text',
          metadata TEXT,
          read_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_agents ON messages(from_agent, to_agent)
      `)
    }
  },
  {
    id: '005_users',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'operator',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_login_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          ip_address TEXT,
          user_agent TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
      `)
    }
  },
  {
    id: '006_workflow_templates',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          model TEXT NOT NULL DEFAULT 'sonnet',
          task_prompt TEXT NOT NULL,
          timeout_seconds INTEGER NOT NULL DEFAULT 300,
          agent_role TEXT,
          tags TEXT,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_used_at INTEGER,
          use_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_workflow_templates_name ON workflow_templates(name);
        CREATE INDEX IF NOT EXISTS idx_workflow_templates_created_by ON workflow_templates(created_by);
      `)
    }
  },
  {
    id: '007_audit_log',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          actor_id INTEGER,
          target_type TEXT,
          target_id INTEGER,
          detail TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
      `)
    }
  },
  {
    id: '008_webhooks',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS webhooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          secret TEXT,
          events TEXT NOT NULL DEFAULT '["*"]',
          enabled INTEGER NOT NULL DEFAULT 1,
          last_fired_at INTEGER,
          last_status INTEGER,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          webhook_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status_code INTEGER,
          response_body TEXT,
          error TEXT,
          duration_ms INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);
        CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);
      `)
    }
  },
  {
    id: '009_pipelines',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_pipelines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          steps TEXT NOT NULL DEFAULT '[]',
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          use_count INTEGER NOT NULL DEFAULT 0,
          last_used_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS pipeline_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pipeline_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          current_step INTEGER NOT NULL DEFAULT 0,
          steps_snapshot TEXT NOT NULL DEFAULT '[]',
          started_at INTEGER,
          completed_at INTEGER,
          triggered_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (pipeline_id) REFERENCES workflow_pipelines(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id);
        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_pipelines_name ON workflow_pipelines(name);
      `)
    }
  },
  {
    id: '010_settings',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          description TEXT,
          category TEXT NOT NULL DEFAULT 'general',
          updated_by TEXT,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
      `)
    }
  },
  {
    id: '011_alert_rules',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS alert_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          entity_type TEXT NOT NULL,
          condition_field TEXT NOT NULL,
          condition_operator TEXT NOT NULL,
          condition_value TEXT NOT NULL,
          action_type TEXT NOT NULL DEFAULT 'notification',
          action_config TEXT NOT NULL DEFAULT '{}',
          cooldown_minutes INTEGER NOT NULL DEFAULT 60,
          last_triggered_at INTEGER,
          trigger_count INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
        CREATE INDEX IF NOT EXISTS idx_alert_rules_entity_type ON alert_rules(entity_type);
      `)
    }
  },
  {
    id: '012_super_admin_tenants',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tenants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          linux_user TEXT NOT NULL UNIQUE,
          plan_tier TEXT NOT NULL DEFAULT 'standard',
          status TEXT NOT NULL DEFAULT 'pending',
          openclaw_home TEXT NOT NULL,
          workspace_root TEXT NOT NULL,
          gateway_port INTEGER,
          dashboard_port INTEGER,
          config TEXT NOT NULL DEFAULT '{}',
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS provision_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          job_type TEXT NOT NULL DEFAULT 'bootstrap',
          status TEXT NOT NULL DEFAULT 'queued',
          dry_run INTEGER NOT NULL DEFAULT 1,
          requested_by TEXT NOT NULL DEFAULT 'system',
          approved_by TEXT,
          runner_host TEXT,
          idempotency_key TEXT,
          request_json TEXT NOT NULL DEFAULT '{}',
          plan_json TEXT NOT NULL DEFAULT '[]',
          result_json TEXT,
          error_text TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS provision_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL,
          level TEXT NOT NULL DEFAULT 'info',
          step_key TEXT,
          message TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (job_id) REFERENCES provision_jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
        CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
        CREATE INDEX IF NOT EXISTS idx_provision_jobs_tenant_id ON provision_jobs(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_provision_jobs_status ON provision_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_provision_jobs_created_at ON provision_jobs(created_at);
        CREATE INDEX IF NOT EXISTS idx_provision_events_job_id ON provision_events(job_id);
        CREATE INDEX IF NOT EXISTS idx_provision_events_created_at ON provision_events(created_at);
      `)
    }
  },
  {
    id: '013_tenant_owner_gateway',
    up: (db) => {
      // Check if tenants table exists (may not on fresh installs without super-admin)
      const hasTenants = (db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'`
      ).get() as any)
      if (!hasTenants) return

      const columns = db.prepare(`PRAGMA table_info(tenants)`).all() as Array<{ name: string }>
      const hasOwnerGateway = columns.some((c) => c.name === 'owner_gateway')
      if (!hasOwnerGateway) {
        db.exec(`ALTER TABLE tenants ADD COLUMN owner_gateway TEXT`)
      }

      const defaultGatewayName =
        String(process.env.MC_DEFAULT_OWNER_GATEWAY || process.env.MC_DEFAULT_GATEWAY_NAME || 'primary').trim() ||
        'primary'

      // Check if gateways table exists (created lazily by gateways API, not in migrations)
      const hasGateways = (db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='gateways'`
      ).get() as any)

      if (hasGateways) {
        db.prepare(`
          UPDATE tenants
          SET owner_gateway = COALESCE(
            (SELECT name FROM gateways ORDER BY is_primary DESC, id ASC LIMIT 1),
            ?
          )
          WHERE owner_gateway IS NULL OR trim(owner_gateway) = ''
        `).run(defaultGatewayName)
      } else {
        db.prepare(`
          UPDATE tenants
          SET owner_gateway = ?
          WHERE owner_gateway IS NULL OR trim(owner_gateway) = ''
        `).run(defaultGatewayName)
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_tenants_owner_gateway ON tenants(owner_gateway)`)
    }
  },
  {
    id: '014_auth_google_approvals',
    up: (db) => {
      const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>
      const has = (name: string) => userCols.some((c) => c.name === name)

      if (!has('provider')) db.exec(`ALTER TABLE users ADD COLUMN provider TEXT NOT NULL DEFAULT 'local'`)
      if (!has('provider_user_id')) db.exec(`ALTER TABLE users ADD COLUMN provider_user_id TEXT`)
      if (!has('email')) db.exec(`ALTER TABLE users ADD COLUMN email TEXT`)
      if (!has('avatar_url')) db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`)
      if (!has('is_approved')) db.exec(`ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 1`)
      if (!has('approved_by')) db.exec(`ALTER TABLE users ADD COLUMN approved_by TEXT`)
      if (!has('approved_at')) db.exec(`ALTER TABLE users ADD COLUMN approved_at INTEGER`)

      db.exec(`
        UPDATE users
        SET provider = COALESCE(NULLIF(provider, ''), 'local'),
            is_approved = COALESCE(is_approved, 1)
      `)

      db.exec(`
        CREATE TABLE IF NOT EXISTS access_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL DEFAULT 'google',
          email TEXT NOT NULL,
          provider_user_id TEXT,
          display_name TEXT,
          avatar_url TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
          attempt_count INTEGER NOT NULL DEFAULT 1,
          reviewed_by TEXT,
          reviewed_at INTEGER,
          review_note TEXT,
          approved_user_id INTEGER,
          FOREIGN KEY (approved_user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `)

      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email_provider ON access_requests(email, provider)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`)
    }
  },
  {
    id: '015_missing_indexes',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient, read_at);
        CREATE INDEX IF NOT EXISTS idx_activities_actor ON activities(actor);
        CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_messages_read_at ON messages(read_at);
      `)
    }
  },
  {
    id: '016_direct_connections',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS direct_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          tool_version TEXT,
          connection_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'connected',
          last_heartbeat INTEGER,
          metadata TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_direct_connections_agent_id ON direct_connections(agent_id);
        CREATE INDEX IF NOT EXISTS idx_direct_connections_connection_id ON direct_connections(connection_id);
        CREATE INDEX IF NOT EXISTS idx_direct_connections_status ON direct_connections(status);
      `)
    }
  },
  {
    id: '017_github_sync',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS github_syncs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repo TEXT NOT NULL,
          last_synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
          issue_count INTEGER NOT NULL DEFAULT 0,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          status TEXT NOT NULL DEFAULT 'success',
          error TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_github_syncs_repo ON github_syncs(repo);
        CREATE INDEX IF NOT EXISTS idx_github_syncs_created_at ON github_syncs(created_at);
      `)
    }
  },
  {
    id: '018_token_usage',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS token_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL,
          session_id TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(session_id);
        CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
        CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);
      `)
    }
  },
  {
    id: '019_webhook_retry',
    up: (db) => {
      // Add retry columns to webhook_deliveries
      const deliveryCols = db.prepare(`PRAGMA table_info(webhook_deliveries)`).all() as Array<{ name: string }>
      const hasCol = (name: string) => deliveryCols.some((c) => c.name === name)

      if (!hasCol('attempt')) db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0`)
      if (!hasCol('next_retry_at')) db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN next_retry_at INTEGER`)
      if (!hasCol('is_retry')) db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN is_retry INTEGER NOT NULL DEFAULT 0`)
      if (!hasCol('parent_delivery_id')) db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN parent_delivery_id INTEGER`)

      // Add circuit breaker column to webhooks
      const webhookCols = db.prepare(`PRAGMA table_info(webhooks)`).all() as Array<{ name: string }>
      if (!webhookCols.some((c) => c.name === 'consecutive_failures')) {
        db.exec(`ALTER TABLE webhooks ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`)
      }

      // Partial index for retry queue processing
      db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL`)
    }
  },
  {
    id: '020_claude_sessions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS claude_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL UNIQUE,
          project_slug TEXT NOT NULL,
          project_path TEXT,
          model TEXT,
          git_branch TEXT,
          user_messages INTEGER NOT NULL DEFAULT 0,
          assistant_messages INTEGER NOT NULL DEFAULT 0,
          tool_uses INTEGER NOT NULL DEFAULT 0,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          estimated_cost REAL NOT NULL DEFAULT 0,
          first_message_at TEXT,
          last_message_at TEXT,
          last_user_prompt TEXT,
          is_active INTEGER NOT NULL DEFAULT 0,
          scanned_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_claude_sessions_active ON claude_sessions(is_active) WHERE is_active = 1`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_claude_sessions_project ON claude_sessions(project_slug)`)
    }
  },
  {
    id: '021_workspace_isolation_phase1',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `)

      db.prepare(`
        INSERT OR IGNORE INTO workspaces (id, slug, name, created_at, updated_at)
        VALUES (1, 'default', 'Default Workspace', unixepoch(), unixepoch())
      `).run()

      const addWorkspaceIdColumn = (table: string) => {
        const tableExists = db
          .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table) as { ok?: number } | undefined
        if (!tableExists?.ok) return

        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
        if (!cols.some((c) => c.name === 'workspace_id')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`)
        }
        db.exec(`UPDATE ${table} SET workspace_id = COALESCE(workspace_id, 1)`)
      }

      const scopedTables = [
        'users',
        'user_sessions',
        'tasks',
        'agents',
        'comments',
        'activities',
        'notifications',
        'quality_reviews',
        'standup_reports',
      ]

      for (const table of scopedTables) {
        addWorkspaceIdColumn(table)
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_workspace_id ON users(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_workspace_id ON user_sessions(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON agents(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_workspace_id ON comments(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_workspace_id ON activities(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_workspace_id ON notifications(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_quality_reviews_workspace_id ON quality_reviews(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_standup_reports_workspace_id ON standup_reports(workspace_id)`)
    }
  },
  {
    id: '022_workspace_isolation_phase2',
    up: (db) => {
      const addWorkspaceIdColumn = (table: string) => {
        const tableExists = db
          .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table) as { ok?: number } | undefined
        if (!tableExists?.ok) return

        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
        if (!cols.some((c) => c.name === 'workspace_id')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`)
        }
        db.exec(`UPDATE ${table} SET workspace_id = COALESCE(workspace_id, 1)`)
      }

      const scopedTables = [
        'messages',
        'alert_rules',
        'direct_connections',
        'github_syncs',
        'workflow_pipelines',
        'pipeline_runs',
      ]

      for (const table of scopedTables) {
        addWorkspaceIdColumn(table)
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON messages(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace_id ON alert_rules(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_connections_workspace_id ON direct_connections(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_github_syncs_workspace_id ON github_syncs(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_pipelines_workspace_id ON workflow_pipelines(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_workspace_id ON pipeline_runs(workspace_id)`)
    }
  },
  {
    id: '023_workspace_isolation_phase3',
    up: (db) => {
      const addWorkspaceIdColumn = (table: string) => {
        const tableExists = db
          .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table) as { ok?: number } | undefined
        if (!tableExists?.ok) return

        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
        if (!cols.some((c) => c.name === 'workspace_id')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`)
        }
        db.exec(`UPDATE ${table} SET workspace_id = COALESCE(workspace_id, 1)`)
      }

      const scopedTables = [
        'workflow_templates',
        'webhooks',
        'webhook_deliveries',
        'token_usage',
      ]

      for (const table of scopedTables) {
        addWorkspaceIdColumn(table)
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_templates_workspace_id ON workflow_templates(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_workspace_id ON webhooks(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_workspace_id ON webhook_deliveries(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_workspace_id ON token_usage(workspace_id)`)
    }
  },
  {
    id: '024_projects_support',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          description TEXT,
          ticket_prefix TEXT NOT NULL,
          ticket_counter INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(workspace_id, slug),
          UNIQUE(workspace_id, ticket_prefix)
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_workspace_status ON projects(workspace_id, status)`)

      const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
      if (!taskCols.some((c) => c.name === 'project_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN project_id INTEGER`)
      }
      if (!taskCols.some((c) => c.name === 'project_ticket_no')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN project_ticket_no INTEGER`)
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_project ON tasks(workspace_id, project_id)`)

      const workspaceRows = db.prepare(`SELECT id FROM workspaces ORDER BY id ASC`).all() as Array<{ id: number }>
      const ensureDefaultProject = db.prepare(`
        INSERT OR IGNORE INTO projects (workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, created_at, updated_at)
        VALUES (?, 'General', 'general', 'Default project for uncategorized tasks', 'TASK', 0, 'active', unixepoch(), unixepoch())
      `)
      const getDefaultProject = db.prepare(`
        SELECT id, ticket_counter FROM projects
        WHERE workspace_id = ? AND slug = 'general'
        LIMIT 1
      `)
      const setTaskProject = db.prepare(`
        UPDATE tasks SET project_id = ?
        WHERE workspace_id = ? AND (project_id IS NULL OR project_id = 0)
      `)
      const listProjectTasks = db.prepare(`
        SELECT id FROM tasks
        WHERE workspace_id = ? AND project_id = ?
        ORDER BY created_at ASC, id ASC
      `)
      const setTaskNo = db.prepare(`UPDATE tasks SET project_ticket_no = ? WHERE id = ?`)
      const setProjectCounter = db.prepare(`UPDATE projects SET ticket_counter = ?, updated_at = unixepoch() WHERE id = ?`)

      for (const workspace of workspaceRows) {
        ensureDefaultProject.run(workspace.id)
        const defaultProject = getDefaultProject.get(workspace.id) as { id: number; ticket_counter: number } | undefined
        if (!defaultProject) continue

        setTaskProject.run(defaultProject.id, workspace.id)

        const projectRows = db.prepare(`
          SELECT id FROM projects
          WHERE workspace_id = ?
          ORDER BY id ASC
        `).all(workspace.id) as Array<{ id: number }>

        for (const project of projectRows) {
          const tasks = listProjectTasks.all(workspace.id, project.id) as Array<{ id: number }>
          let counter = 0
          for (const task of tasks) {
            counter += 1
            setTaskNo.run(counter, task.id)
          }
          setProjectCounter.run(counter, project.id)
        }
      }
    }
  },
  {
    id: '025_token_usage_task_attribution',
    up: (db) => {
      const hasTokenUsageTable = db
        .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'token_usage'`)
        .get() as { ok?: number } | undefined

      if (!hasTokenUsageTable?.ok) return

      const cols = db.prepare(`PRAGMA table_info(token_usage)`).all() as Array<{ name: string }>
      const hasCol = (name: string) => cols.some((c) => c.name === name)

      if (!hasCol('task_id')) {
        db.exec(`ALTER TABLE token_usage ADD COLUMN task_id INTEGER`)
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_task_id ON token_usage(task_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_workspace_task_time ON token_usage(workspace_id, task_id, created_at)`)
    }
  },
  {
    id: '026_task_outcome_tracking',
    up: (db) => {
      const hasTasks = db
        .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`)
        .get() as { ok?: number } | undefined
      if (!hasTasks?.ok) return

      const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
      const hasCol = (name: string) => taskCols.some((c) => c.name === name)

      if (!hasCol('outcome')) db.exec(`ALTER TABLE tasks ADD COLUMN outcome TEXT`)
      if (!hasCol('error_message')) db.exec(`ALTER TABLE tasks ADD COLUMN error_message TEXT`)
      if (!hasCol('resolution')) db.exec(`ALTER TABLE tasks ADD COLUMN resolution TEXT`)
      if (!hasCol('feedback_rating')) db.exec(`ALTER TABLE tasks ADD COLUMN feedback_rating INTEGER`)
      if (!hasCol('feedback_notes')) db.exec(`ALTER TABLE tasks ADD COLUMN feedback_notes TEXT`)
      if (!hasCol('retry_count')) db.exec(`ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`)
      if (!hasCol('completed_at')) db.exec(`ALTER TABLE tasks ADD COLUMN completed_at INTEGER`)

      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_outcome ON tasks(outcome)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_outcome ON tasks(workspace_id, outcome, completed_at)`)
    }
  },
  {
    id: '027_agent_api_keys',
    up: (db) => {
      const hasAgents = db
        .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'agents'`)
        .get() as { ok?: number } | undefined
      if (!hasAgents?.ok) return

      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          key_prefix TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '["viewer"]',
          expires_at INTEGER,
          revoked_at INTEGER,
          created_by TEXT,
          last_used_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );
      `)

      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent_id ON agent_api_keys(agent_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_workspace_id ON agent_api_keys(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_expires_at ON agent_api_keys(expires_at)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_revoked_at ON agent_api_keys(revoked_at)`)
    }
  }
]

export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row: any) => row.id)
  )

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(migration.id)
    })()
  }
}
