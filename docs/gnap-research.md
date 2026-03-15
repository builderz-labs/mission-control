# GNAP: Git-Native Task Backend for Mission Control

## Research Document

**Issue:** #374
**Date:** 2025-03-15
**Status:** Research Phase

---

## Executive Summary

GNAP (Git-Native Agent Protocol) is a zero-infrastructure protocol for agent orchestration that uses git as the storage and transport layer. This research explores integrating GNAP as Mission Control's task backend to enable better collaboration, version control, and offline capability.

### Key Findings

✅ **Strong Alignment**: GNAP's design philosophy aligns perfectly with Mission Control's goals
✅ **Feasible Integration**: Straightforward mapping between existing SQLite schema and GNAP entities
✅ **Significant Benefits**: Audit trail, offline capability, zero infrastructure
⚠️ **Migration Complexity**: Existing data migration strategy needed
⚠️ **Concurrency**: Eventual consistency model requires different conflict handling

---

## Current Architecture

### Storage Layer
- **Database:** SQLite (`better-sqlite3`)
- **Location:** `.data/mission-control.db` (configurable)
- **Tables:**
  - `tasks` - Kanban board tasks
  - `agents` - Agent registry
  - `comments` - Task discussions
  - `activities` - Activity stream
  - `notifications` - User notifications
  - `messages` - Agent-to-agent messaging
  - `quality_reviews` - Quality gate reviews

### Task Schema (Simplified)
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT, -- inbox, assigned, in_progress, review, quality_review, done
  priority TEXT,
  assigned_to TEXT,
  created_by TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  -- ... many more fields
);
```

### Current Workflow
```
Dashboard → SQLite DB → API Routes → Client
```

---

## GNAP Architecture

### Storage Layer
- **Backend:** Git repository
- **Protocol:** 4 JSON files
- **Location:** `.gnap/` directory in any git repo
- **Structure:**
```
.gnap/
  version          # Protocol version (e.g., "4")
  agents.json      # Team registry
  tasks/           # Tasks as JSON files (FA-1.json, FA-2.json, ...)
  runs/            # Execution attempts (FA-1-1.json, ...)
  messages/        # Agent messages (1.json, 2.json, ...)
```

### GNAP Entities

#### 1. Agent (`agents.json`)
```json
{
  "agents": [
    {
      "id": "carl",
      "name": "Carl",
      "role": "CRO",
      "type": "ai",
      "status": "active",
      "runtime": "openclaw",
      "reports_to": "ori",
      "heartbeat_sec": 300,
      "contact": { "telegram": "@carl" },
      "capabilities": ["research", "analysis"]
    }
  ]
}
```

#### 2. Task (`tasks/{id}.json`)
```json
{
  "id": "FA-1",
  "title": "Set up Stripe billing",
  "assigned_to": ["leo"],
  "state": "in_progress",
  "priority": 0,
  "created_by": "ori",
  "created_at": "2026-03-12T11:40:00Z",
  "parent": null,
  "desc": "Full description here...",
  "due": "2026-03-15T00:00:00Z",
  "blocked": false,
  "reviewer": "aegis",
  "updated_at": "2026-03-12T12:00:00Z",
  "tags": ["billing", "infrastructure"],
  "comments": [
    { "by": "ori", "at": "2026-03-12T11:45:00Z", "text": "Urgent!" }
  ]
}
```

#### 3. Run (`runs/{task-id}-{attempt}.json`)
```json
{
  "id": "FA-1-1",
  "task": "FA-1",
  "agent": "carl",
  "state": "completed",
  "attempt": 1,
  "started_at": "2026-03-12T12:30:00Z",
  "finished_at": "2026-03-12T12:35:00Z",
  "tokens": { "input": 12400, "output": 3200 },
  "cost_usd": 0.08,
  "result": "Stripe account created, test mode live",
  "commits": ["a1b2c3d"],
  "artifacts": ["/path/to/file"]
}
```

#### 4. Message (`messages/{id}.json`)
```json
{
  "id": "1",
  "from": "ori",
  "to": ["carl"],
  "at": "2026-03-12T09:30:00Z",
  "type": "directive",
  "text": "Focus on billing first. Everything else can wait.",
  "channel": "billing",
  "thread": null,
  "read_by": ["carl"]
}
```

### GNAP Workflow
```
1. git pull
2. Read agents.json → am I active?
3. Read tasks/ → anything assigned to me?
4. Read messages/ → anything new for me?
5. Do the work → commit → git push
6. Sleep until next heartbeat
```

### Task State Machine
```
backlog → ready → in_progress → review → done
   ↑         ↑          ↑          │
   │         │          └──────────┘ (reviewer rejects)
   │         └─────────────────────
   │                             (unblocked)
   └───────────────────────────
blocked → ready (unblocked)
   ↓
cancelled
```

---

## Comparison: SQLite vs GNAP

| Aspect | SQLite (Current) | GNAP (Proposed) |
|--------|------------------|-----------------|
| **Infrastructure** | Single database file | Git repository |
| **Server Required** | No (file-based) | No (distributed) |
| **Setup Time** | < 1 min | < 1 min |
| **Audit Trail** | Activities table | Git log (native) |
| **Version Control** | Manual snapshots | Native git history |
| **Offline Capability** | Limited | Full (work offline, sync later) |
| **Conflict Resolution** | Row locking | Git merge/rebase |
| **Multi-machine Sync** | Manual | Native git push/pull |
| **Collaboration** | Single instance | Shared repo (multi-user) |
| **Data Portability** | SQL dump | Git clone |
| **Backup** | File copy | Git push to remote |
| **Rollback** | Database restore | Git revert/reset |
| **Cost Tracking** | Requires custom logic | Built-in (runs/*.json) |
| **Agent Coordination** | Polling DB | Heartbeat loop + git |
| **Vendor Lock-in** | SQLite (minimal) | Git (none) |
| **API Complexity** | CRUD operations | Git operations |
| **Consistency Model** | ACID | Eventual (git merge) |
| **Query Capabilities** | SQL | File system + grep/jq |

---

## Schema Mapping

### Tasks Table → GNAP Tasks

| SQLite Field | GNAP Field | Notes |
|--------------|------------|-------|
| `id` | `id` | Convert INTEGER to STRING (e.g., "123") |
| `title` | `title` | Direct mapping |
| `description` | `desc` | Rename |
| `status` | `state` | Map: inbox→backlog, assigned→ready, in_progress→in_progress, review→review, quality_review→review, done→done |
| `priority` | `priority` | Convert: low→3, medium→2, high→1, critical→0, urgent→0 |
| `assigned_to` | `assigned_to` | STRING → ARRAY of strings |
| `created_by` | `created_by` | Direct mapping |
| `created_at` | `created_at` | Unix timestamp → ISO 8601 |
| `updated_at` | `updated_at` | Unix timestamp → ISO 8601 |
| `due_date` | `due` | Unix timestamp → ISO 8601 |
| `tags` | `tags` | JSON string → Array |
| `outcome` | Store in runs | Move to run results |
| `error_message` | Store in runs | Move to run errors |
| `resolution` | Store in runs | Move to run results |
| `feedback_rating` | Store in runs | Move to run results |
| `retry_count` | Use runs count | Calculate from runs/ |
| `completed_at` | Inferred from runs | Last completed run |
| `project_id` | Store in `tags` | Add as tag: `project:123` |
| `github_issue_number` | Store in `tags` | Add as tag: `github:issue/123` |
| `github_synced_at` | Store in `tags` | Add as tag with timestamp |

### Agents Table → GNAP Agents

| SQLite Field | GNAP Field | Notes |
|--------------|------------|-------|
| `id` | `id` | Convert INTEGER to STRING |
| `name` | `name` | Direct mapping |
| `role` | `role` | Direct mapping |
| `session_key` | `runtime` | Map session key to runtime type |
| `status` | `status` | Map: offline→terminated, idle→active, busy→active, error→paused |
| `soul_content` | Store separately | Could store as metadata or external file |
| `last_seen` | Not in GNAP | Can infer from runs/ |
| `last_activity` | Not in GNAP | Can infer from runs/ |
| `config` | Store in `capabilities` | Add capabilities from config |

### Comments → GNAP Task Comments
| SQLite Field | GNAP Field | Notes |
|--------------|------------|-------|
| `task_id` | Parent task file | Comments stored in task `comments` array |
| `author` | `by` | Rename |
| `content` | `text` | Rename |
| `created_at` | `at` | Unix timestamp → ISO 8601 |
| `parent_id` | Not directly supported | Could use `thread` reference |
| `mentions` | Parse from text | @mentions in comment text |

### Activities → Git Log
| SQLite Field | Git Log Field | Notes |
|--------------|---------------|-------|
| `type` | Commit message prefix | e.g., "feat: task_created" |
| `entity_type` | Commit message | Include in message |
| `entity_id` | Commit message | Include task/agent ID |
| `actor` | Commit author | Use agent/user name |
| `description` | Commit message | Full description |
| `data` | Commit message body | JSON as message body |
| `created_at` | Commit timestamp | Unix timestamp → git timestamp |

### Notifications → GNAP Messages
| SQLite Field | GNAP Field | Notes |
|--------------|------------|-------|
| `recipient` | `to` | STRING → ARRAY |
| `type` | `type` | Map to GNAP types |
| `title` | Store in `text` | Include in message text |
| `message` | `text` | Direct mapping |
| `source_type` | Not in GNAP | Include in message text |
| `source_id` | Not in GNAP | Include in message text |
| `read_at` | `read_by` | Track read recipients |
| `created_at` | `at` | Unix timestamp → ISO 8601 |

### Quality Reviews → Custom GNAP Extension
| SQLite Field | GNAP Extension | Notes |
|--------------|----------------|-------|
| `task_id` | Task `reviewer` field | Built-in GNAP |
| `reviewer` | Task `reviewer` field | Built-in GNAP |
| `status` | Run `state` or task comment | Use to create review run |
| `notes` | Task comment or message | Add review comment |
| `created_at` | ISO 8601 | Timestamp |

---

## Proposed Architecture: Hybrid Approach

### Phase 1: Dual Backend (Recommended)
```
┌─────────────────────────────────────────────────────┐
│                  Mission Control                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐         ┌──────────────┐         │
│  │   SQLite     │         │   GNAP Git   │         │
│  │  (Primary)   │         │   (Sync)     │         │
│  └──────┬───────┘         └──────┬───────┘         │
│         │                        │                  │
│         └──────────┬─────────────┘                  │
│                    │                                │
│         ┌──────────▼──────────┐                    │
│         │  Sync Engine        │                    │
│         │  (bidirectional)    │                    │
│         └─────────────────────┘                    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Strategy:**
1. Keep SQLite as primary backend (backward compatibility)
2. Add GNAP as optional sync backend
3. Implement bidirectional sync engine
4. Allow users to enable GNAP via configuration
5. Gradual migration path

### Phase 2: GNAP-First
- Flip backend order (GNAP primary, SQLite fallback)
- Add migration tool to fully migrate from SQLite to GNAP
- Deprecate SQLite (keep for read-only historical data)

### Phase 3: GNAP-Native
- Remove SQLite entirely
- Full git-native workflow
- Zero database dependencies

---

## Implementation Plan

### Step 1: GNAP Library (`src/lib/gnap/`)
Create a new library to handle GNAP operations:

```
src/lib/gnap/
  ├── index.ts              # Main exports
  ├── agent.ts              # Agent operations
  ├── task.ts               # Task operations
  ├── run.ts                # Run operations
  ├── message.ts            # Message operations
  ├── repo.ts               # Git repository operations
  ├── sync.ts               # SQLite ↔ GNAP sync
  ├── schema.ts             # GNAP schemas (Zod)
  └── types.ts              # TypeScript types
```

### Step 2: GNAP Types & Schemas
Define TypeScript types and Zod schemas for GNAP entities:

```typescript
// src/lib/gnap/types.ts
export interface GNAPAgent {
  id: string
  name: string
  role: string
  type: 'ai' | 'human'
  status: 'active' | 'paused' | 'terminated'
  runtime?: string
  reports_to?: string
  heartbeat_sec?: number
  contact?: Record<string, string>
  capabilities?: string[]
}

export interface GNAPTask {
  id: string
  title: string
  assigned_to: string[]
  state: 'backlog' | 'ready' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled'
  priority: number
  created_by: string
  created_at: string  // ISO 8601
  parent?: string
  desc?: string
  due?: string  // ISO 8601
  blocked?: boolean
  blocked_reason?: string
  reviewer?: string
  updated_at?: string  // ISO 8601
  tags?: string[]
  comments?: GNAPComment[]
}

export interface GNAPComment {
  by: string
  at: string  // ISO 8601
  text: string
}

export interface GNAPRun {
  id: string
  task: string
  agent: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  attempt: number
  started_at: string  // ISO 8601
  finished_at?: string  // ISO 8601
  tokens?: { input: number; output: number }
  cost_usd?: number
  result?: string
  error?: string
  commits?: string[]
  artifacts?: string[]
}

export interface GNAPMessage {
  id: string
  from: string
  to: string[]
  at: string  // ISO 8601
  text: string
  type?: 'directive' | 'status' | 'request' | 'info' | 'alert'
  channel?: string
  thread?: string
  read_by?: string[]
}

export interface GNAPVersion {
  version: string
}

export interface GNAPAgentsFile {
  agents: GNAPAgent[]
}

export interface GNAPConfig {
  repoPath: string
  enabled: boolean
  autoSync: boolean
  syncIntervalSec: number
}
```

### Step 3: Git Operations (`src/lib/gnap/repo.ts`)
Implement git operations:

```typescript
import { execSync } from 'child_process';
import { join } from 'path';

export class GNAPRepo {
  constructor(private repoPath: string) {}

  async init() {
    // Initialize git repo if needed
    // Create .gnap/ directory
    // Create version file
  }

  async pull() {
    // git pull
  }

  async push(message: string) {
    // git add .gnap/
    // git commit -m message
    // git push
  }

  async status() {
    // git status
  }

  async log(count = 10) {
    // git log
  }

  async checkout(branch?: string) {
    // git checkout
  }

  async merge(branch: string) {
    // git merge
  }

  async hasChanges(): Promise<boolean> {
    // Check if .gnap/ has uncommitted changes
  }

  async resolveConflicts(): Promise<void> {
    // Simple conflict resolution strategy
    // Could be configurable
  }
}
```

### Step 4: Task Operations (`src/lib/gnap/task.ts`)
Implement task CRUD operations:

```typescript
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { GNAPRepo } from './repo';
import { GNAPTask, gnapTaskSchema } from './types';

export class GNAPTaskManager {
  constructor(private repo: GNAPRepo) {}

  async getTask(id: string): Promise<GNAPTask | null> {
    const filePath = join(this.repo.repoPath, '.gnap', 'tasks', `${id}.json`);
    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async listTasks(): Promise<GNAPTask[]> {
    const tasksDir = join(this.repo.repoPath, '.gnap', 'tasks');
    const files = readdirSync(tasksDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const content = readFileSync(join(tasksDir, f), 'utf-8');
      return JSON.parse(content);
    });
  }

  async createTask(task: GNAPTask): Promise<void> {
    const filePath = join(this.repo.repoPath, '.gnap', 'tasks', `${task.id}.json`);
    writeFileSync(filePath, JSON.stringify(task, null, 2));
  }

  async updateTask(task: GNAPTask): Promise<void> {
    await this.createTask(task); // Overwrite
  }

  async deleteTask(id: string): Promise<void> {
    const filePath = join(this.repo.repoPath, '.gnap', 'tasks', `${id}.json`);
    unlinkSync(filePath);
  }

  async filterTasks(filter: {
    assigned_to?: string;
    state?: string;
    priority?: number;
  }): Promise<GNAPTask[]> {
    const tasks = await this.listTasks();
    return tasks.filter(task => {
      if (filter.assigned_to && !task.assigned_to.includes(filter.assigned_to)) {
        return false;
      }
      if (filter.state && task.state !== filter.state) {
        return false;
      }
      if (filter.priority !== undefined && task.priority !== filter.priority) {
        return false;
      }
      return true;
    });
  }
}
```

### Step 5: Sync Engine (`src/lib/gnap/sync.ts`)
Implement bidirectional sync between SQLite and GNAP:

```typescript
import { getDatabase } from '@/lib/db';
import { GNAPRepo } from './repo';
import { GNAPTaskManager } from './task';
import { GNAPAgentManager } from './agent';
import { mapSQLiteTaskToGNAP, mapGNAPTaskToSQLite } from './mapper';

export class GNAPSyncEngine {
  private lastSync: number = 0;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(
    private repo: GNAPRepo,
    private taskManager: GNAPTaskManager,
    private agentManager: GNAPAgentManager
  ) {}

  async fullSync(): Promise<void> {
    // 1. Pull latest changes
    await this.repo.pull();

    // 2. Check for conflicts
    const hasConflicts = await this.repo.hasChanges();
    if (hasConflicts) {
      await this.repo.resolveConflicts();
    }

    // 3. Sync tasks: SQLite → GNAP
    await this.syncTasksToGNAP();

    // 4. Sync tasks: GNAP → SQLite
    await this.syncTasksFromGNAP();

    // 5. Sync agents: SQLite → GNAP
    await this.syncAgentsToGNAP();

    // 6. Sync agents: GNAP → SQLite
    await this.syncAgentsFromGNAP();

    // 7. Push changes
    await this.repo.push('Sync with Mission Control');

    this.lastSync = Date.now();
  }

  private async syncTasksToGNAP(): Promise<void> {
    const db = getDatabase();
    const tasks = db.prepare('SELECT * FROM tasks WHERE updated_at > ?').all(this.lastSync / 1000) as Task[];

    for (const task of tasks) {
      const gnapTask = mapSQLiteTaskToGNAP(task);
      await this.taskManager.createTask(gnapTask);
    }
  }

  private async syncTasksFromGNAP(): Promise<void> {
    const gnapTasks = await this.taskManager.listTasks();
    const db = getDatabase();

    for (const gnapTask of gnapTasks) {
      const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(gnapTask.id);
      const task = mapGNAPTaskToSQLite(gnapTask);

      if (!existing) {
        // Insert new task
        db.prepare(`
          INSERT INTO tasks (${Object.keys(task).join(', ')})
          VALUES (${Object.keys(task).map(() => '?').join(', ')})
        `).run(...Object.values(task));
      } else if (existing.updated_at < task.updated_at) {
        // Update existing task
        const setClause = Object.keys(task).map(k => `${k} = ?`).join(', ');
        db.prepare(`UPDATE tasks SET ${setClause} WHERE id = ?`)
          .run(...Object.values(task), gnapTask.id);
      }
    }
  }

  private async syncAgentsToGNAP(): Promise<void> {
    const db = getDatabase();
    const agents = db.prepare('SELECT * FROM agents WHERE updated_at > ?').all(this.lastSync / 1000) as Agent[];

    const gnapAgents = agents.map(mapSQLiteAgentToGNAP);
    await this.agentManager.updateAgentsFile(gnapAgents);
  }

  private async syncAgentsFromGNAP(): Promise<void> {
    const gnapAgents = await this.agentManager.listAgents();
    const db = getDatabase();

    for (const gnapAgent of gnapAgents) {
      const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(gnapAgent.id);
      const agent = mapGNAPAgentToSQLite(gnapAgent);

      if (!existing) {
        db.prepare(`
          INSERT INTO agents (${Object.keys(agent).join(', ')})
          VALUES (${Object.keys(agent).map(() => '?').join(', ')})
        `).run(...Object.values(agent));
      } else if (existing.updated_at < agent.updated_at) {
        const setClause = Object.keys(agent).map(k => `${k} = ?`).join(', ');
        db.prepare(`UPDATE agents SET ${setClause} WHERE id = ?`)
          .run(...Object.values(agent), gnapAgent.id);
      }
    }
  }

  startAutoSync(intervalSec: number): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    this.syncInterval = setInterval(() => {
      this.fullSync().catch(err => {
        console.error('Auto-sync failed:', err);
      });
    }, intervalSec * 1000);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}
```

### Step 6: Mapper Functions (`src/lib/gnap/mapper.ts`)
Implement bidirectional mapping between SQLite and GNAP:

```typescript
import { Task, Agent } from '@/lib/db';
import { GNAPTask, GNAPAgent } from './types';

// Status mappings
const STATUS_MAP: Record<string, string> = {
  'inbox': 'backlog',
  'assigned': 'ready',
  'in_progress': 'in_progress',
  'review': 'review',
  'quality_review': 'review',
  'done': 'done'
};

const REVERSE_STATUS_MAP: Record<string, string> = {
  'backlog': 'inbox',
  'ready': 'assigned',
  'in_progress': 'in_progress',
  'review': 'review',
  'done': 'done'
};

const PRIORITY_MAP: Record<string, number> = {
  'low': 3,
  'medium': 2,
  'high': 1,
  'critical': 0,
  'urgent': 0
};

const REVERSE_PRIORITY_MAP: Record<number, string> = {
  0: 'critical',
  1: 'high',
  2: 'medium',
  3: 'low'
};

export function mapSQLiteTaskToGNAP(task: Task): GNAPTask {
  const tags: string[] = task.tags ? JSON.parse(task.tags) : [];

  // Add project as tag if present
  if (task.project_id) {
    tags.push(`project:${task.project_id}`);
  }

  // Add GitHub integration tags if present
  if (task.github_issue_number) {
    tags.push(`github:issue/${task.github_issue_number}`);
  }
  if (task.github_repo) {
    tags.push(`github:repo/${task.github_repo}`);
  }

  return {
    id: String(task.id),
    title: task.title,
    assigned_to: task.assigned_to ? [task.assigned_to] : [],
    state: STATUS_MAP[task.status] as any,
    priority: PRIORITY_MAP[task.priority] || 2,
    created_by: task.created_by,
    created_at: new Date(task.created_at * 1000).toISOString(),
    parent: undefined, // Could map from task.parent if added
    desc: task.description,
    due: task.due_date ? new Date(task.due_date * 1000).toISOString() : undefined,
    blocked: false, // Could map from a blocked field if added
    blocked_reason: undefined,
    reviewer: undefined, // Could map from a reviewer field if added
    updated_at: new Date(task.updated_at * 1000).toISOString(),
    tags: tags.length > 0 ? tags : undefined,
    comments: [] // Comments would be synced separately
  };
}

export function mapGNAPTaskToSQLite(gnapTask: GNAPTask): Task {
  // Extract tags
  const tags: string[] = gnapTask.tags || [];
  const projectTag = tags.find(t => t.startsWith('project:'));
  const project_id = projectTag ? parseInt(projectTag.split(':')[1]) : undefined;

  return {
    id: parseInt(gnapTask.id),
    title: gnapTask.title,
    description: gnapTask.desc,
    status: REVERSE_STATUS_MAP[gnapTask.state] as any,
    priority: REVERSE_PRIORITY_MAP[gnapTask.priority] as any,
    project_id,
    project_ticket_no: undefined, // Would need project lookup
    project_name: undefined, // Would need project lookup
    project_prefix: undefined, // Would need project lookup
    assigned_to: gnapTask.assigned_to[0], // Take first assignee
    created_by: gnapTask.created_by,
    created_at: Math.floor(new Date(gnapTask.created_at).getTime() / 1000),
    updated_at: Math.floor(new Date(gnapTask.updated_at || gnapTask.created_at).getTime() / 1000),
    due_date: gnapTask.due ? Math.floor(new Date(gnapTask.due).getTime() / 1000) : undefined,
    estimated_hours: undefined,
    actual_hours: undefined,
    tags: JSON.stringify(tags.filter(t => !t.startsWith('project:') && !t.startsWith('github:'))),
    metadata: undefined,
    outcome: undefined,
    error_message: undefined,
    resolution: undefined,
    feedback_rating: undefined,
    feedback_notes: undefined,
    retry_count: undefined,
    completed_at: undefined // Would need to calculate from runs
  };
}

export function mapSQLiteAgentToGNAP(agent: Agent): GNAPAgent {
  return {
    id: String(agent.id),
    name: agent.name,
    role: agent.role,
    type: agent.session_key ? 'ai' : 'human', // Simple heuristic
    status: agent.status === 'offline' ? 'terminated' : (agent.status === 'error' ? 'paused' : 'active'),
    runtime: agent.session_key ? 'openclaw' : undefined,
    reports_to: undefined, // Could add to SQLite schema
    heartbeat_sec: 300,
    contact: undefined,
    capabilities: agent.config ? Object.keys(JSON.parse(agent.config)) : undefined
  };
}

export function mapGNAPAgentToSQLite(gnapAgent: GNAPAgent): Agent {
  return {
    id: parseInt(gnapAgent.id),
    name: gnapAgent.name,
    role: gnapAgent.role,
    session_key: gnapAgent.runtime === 'openclaw' ? gnapAgent.id : undefined,
    soul_content: undefined,
    status: gnapAgent.status === 'active' ? 'idle' : (gnapAgent.status === 'terminated' ? 'offline' : 'error'),
    last_seen: undefined,
    last_activity: undefined,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    config: gnapAgent.capabilities ? JSON.stringify(gnapAgent.capabilities) : undefined
  };
}
```

### Step 7: Configuration
Add GNAP configuration to `.env`:

```bash
# GNAP Configuration
GNAP_ENABLED=false
GNAP_REPO_PATH=/path/to/gnap/repo
GNAP_AUTO_SYNC=true
GNAP_SYNC_INTERVAL_SEC=300
GNAP_GIT_REMOTE=origin
GNAP_GIT_BRANCH=main
```

Add to `src/lib/config.ts`:

```typescript
export const gnap = {
  enabled: process.env.GNAP_ENABLED === 'true',
  repoPath: process.env.GNAP_REPO_PATH || join(config.dataDir, 'gnap'),
  autoSync: process.env.GNAP_AUTO_SYNC !== 'false',
  syncIntervalSec: parseInt(process.env.GNAP_SYNC_INTERVAL_SEC || '300', 10),
  gitRemote: process.env.GNAP_GIT_REMOTE || 'origin',
  gitBranch: process.env.GNAP_GIT_BRANCH || 'main'
};
```

### Step 8: API Integration
Update API routes to support GNAP sync:

```typescript
// src/app/api/tasks/route.ts
import { getSyncEngine } from '@/lib/gnap';

// After successful POST
if (gnap.enabled) {
  const syncEngine = getSyncEngine();
  syncEngine.fullSync().catch(err => {
    logger.error({ err }, 'GNAP sync failed after task creation');
  });
}

// After successful PUT
if (gnap.enabled) {
  const syncEngine = getSyncEngine();
  syncEngine.fullSync().catch(err => {
    logger.error({ err }, 'GNAP sync failed after task update');
  });
}
```

### Step 9: Migration Tool
Create a one-time migration tool to export existing SQLite data to GNAP:

```typescript
// scripts/migrate-to-gnap.ts
import { getDatabase } from '@/lib/db';
import { GNAPRepo } from '@/lib/gnap/repo';
import { GNAPTaskManager } from '@/lib/gnap/task';
import { mapSQLiteTaskToGNAP } from '@/lib/gnap/mapper';

async function migrate() {
  const db = getDatabase();
  const tasks = db.prepare('SELECT * FROM tasks').all() as Task[];
  const agents = db.prepare('SELECT * FROM agents').all() as Agent[];

  const repo = new GNAPRepo('/path/to/gnap/repo');
  await repo.init();

  const taskManager = new GNAPTaskManager(repo);

  // Migrate agents
  for (const agent of agents) {
    const gnapAgent = mapSQLiteAgentToGNAP(agent);
    await agentManager.createAgent(gnapAgent);
  }

  // Migrate tasks
  for (const task of tasks) {
    const gnapTask = mapSQLiteTaskToGNAP(task);
    await taskManager.createTask(gnapTask);
  }

  // Commit
  await repo.push('Migrate from Mission Control SQLite');

  console.log(`Migrated ${tasks.length} tasks and ${agents.length} agents to GNAP`);
}

migrate().catch(console.error);
```

### Step 10: UI Enhancements
Add GNAP status indicators to the UI:

- Show sync status in dashboard header
- Display "Last synced: X minutes ago"
- Show conflicts when they occur
- Add "Force sync" button
- Display git log as activity timeline

---

## Benefits Analysis

### For Mission Control

✅ **Zero Infrastructure Deployment**
- No database to set up or maintain
- Deploy to any machine with git
- Simple backup strategy (git push to remote)

✅ **Full Audit Trail**
- Every change tracked in git history
- Natural blame annotation
- Easy rollback to any point in time

✅ **Offline Capability**
- Work without internet connection
- Sync changes when back online
- No dependency on external services

✅ **Multi-Machine Collaboration**
- Same tasks accessible from multiple machines
- Natural conflict resolution via git merge
- Shared task state across team

✅ **Cost Tracking Built-In**
- Runs track token usage and costs
- Easy to calculate total spend per task
- Budget enforcement possible

✅ **Human + AI Collaboration**
- Humans are first-class agents in GNAP
- Same workflow for AI and human tasks
- Natural delegation and handoffs

### For Users

✅ **Better Collaboration**
- Multiple users can work on same tasks
- See who changed what and when
- Natural merge conflict resolution

✅ **Portability**
- Move between machines easily
- Export entire workspace as git repo
- Import to new instance with `git clone`

✅ **Version Control**
- Branch for experiments
- Merge back when ready
- Never lose work (git revert)

### For Developers

✅ **Simpler Architecture**
- No database schema migrations
- No ORM to maintain
- File-based storage is intuitive

✅ **Easier Testing**
- Create test repos easily
- No test database setup
- Snapshot tests with git

✅ **Extensibility**
- Add custom fields via tags
- Extend protocol with additional files
- Build application layers on top

---

## Risks & Mitigations

### Risk 1: Concurrency Conflicts
**Issue:** Multiple agents updating same task simultaneously

**Mitigation:**
- Use optimistic locking with `updated_at` timestamp
- Implement automatic conflict resolution strategy
- Provide UI for manual conflict resolution
- Use git branches for concurrent work

### Risk 2: Performance
**Issue:** File I/O and git operations slower than SQL

**Mitigation:**
- Cache frequently accessed tasks in memory
- Use git's efficient diff algorithms
- Implement lazy loading for large task lists
- Consider using SQLite cache for reads, GNAP for writes

### Risk 3: Data Loss
**Issue:** Accidental git reset or force push

**Mitigation:**
- Use protected branches (main, master)
- Require pull requests for critical changes
- Regular backups to remote repositories
- Implement git hooks to prevent destructive operations

### Risk 4: Learning Curve
**Issue:** Team needs to understand git workflow

**Mitigation:**
- Hide git complexity behind abstraction layer
- Provide clear documentation
- Offer training sessions
- Start with hybrid approach (SQLite + GNAP)

### Risk 5: Schema Evolution
**Issue:** GNAP protocol changes over time

**Mitigation:**
- Use version field in `.gnap/version`
- Implement backward compatibility checks
- Provide migration scripts for protocol updates
- Follow semantic versioning

### Risk 6: Large Scale
**Issue:** Performance issues with thousands of tasks

**Mitigation:**
- Implement pagination for task lists
- Use git's efficient storage (deltas)
- Archive old tasks to separate branches
- Consider sharding by project or workspace

---

## Recommendations

### Immediate (Phase 1)

1. **Implement GNAP Library** - Build core GNAP operations as separate module
2. **Create Sync Engine** - Implement bidirectional sync with SQLite
3. **Add Configuration** - Enable GNAP via environment variables
4. **Build Migration Tool** - One-time export from SQLite to GNAP
5. **Add UI Indicators** - Show sync status to users
6. **Write Tests** - Ensure sync engine correctness

### Short Term (Phase 2)

1. **Deploy to Testing** - Test with small team
2. **Monitor Performance** - Profile git operations
3. **Refine Sync Strategy** - Optimize conflict resolution
4. **Add Monitoring** - Track sync health
5. **Document Workflow** - Create user guides

### Long Term (Phase 3)

1. **Make GNAP Primary** - Flip backend order
2. **Deprecate SQLite** - Phase out old backend
3. **Full Migration** - Move all users to GNAP
4. **Remove SQLite** - Simplify codebase
5. **Leverage GNAP Features** - Cost tracking, runs, etc.

---

## Success Metrics

### Technical
- [ ] Sync reliability > 99.9%
- [ ] Sync latency < 5 seconds
- [ ] Zero data loss during sync
- [ ] Conflict resolution < 1 minute
- [ ] Git operations < 100ms per task

### User Experience
- [ ] Users report improved collaboration
- [ ] Reduced friction when working across machines
- [ ] No increase in support tickets
- [ ] Positive feedback on git-based workflow

### Business
- [ ] Reduced infrastructure costs (no separate DB)
- [ ] Faster onboarding of new team members
- [ ] Better audit compliance (git log)
- [ ] Increased productivity (offline work)

---

## Next Steps

1. **Review this document** with team
2. **Get approval** for Phase 1 implementation
3. **Create feature branch** for GNAP integration
4. **Start implementation** following the plan above
5. **Regular updates** on progress

---

## References

- [GNAP GitHub Repository](https://github.com/farol-team/gnap)
- [GNAP RFC](https://github.com/farol-team/gnap/blob/main/docs/rfc.md)
- [Mission Control Issue #374](https://github.com/builderz-labs/mission-control/issues/374)
- [Git Documentation](https://git-scm.com/doc)
- [SQLite Documentation](https://www.sqlite.org/docs.html)

---

**Document Version:** 1.0
**Last Updated:** 2025-03-15
**Author:** GNAP Research Team
