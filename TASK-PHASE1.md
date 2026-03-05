# Phase 1: Wire Task Board to control-center.db

## Goal
Replace MC's built-in `tasks` SQLite table with reads from our existing `control-center.db` SQLite database at `~/.openclaw/control-center.db`. The task board UI should display our issues/projects from that DB.

## Existing DB Schema (control-center.db)

```sql
CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'idea',
    assignee TEXT DEFAULT '',
    priority TEXT DEFAULT 'normal',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived INTEGER DEFAULT 0,
    schedule TEXT NOT NULL DEFAULT '',
    parent_id TEXT REFERENCES issues(id),
    notion_id TEXT DEFAULT ''
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    emoji TEXT DEFAULT '📁',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived INTEGER DEFAULT 0,
    schedule TEXT NOT NULL DEFAULT 'nightly'
);

CREATE TABLE issue_comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE issue_activity (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
```

### Status values in our DB: `idea`, `proposal`, `todo`, `done`
### Priority values: `low`, `normal`, `high`

## Current MC Task Interface
```typescript
interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to?: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  tags?: string;
  metadata?: string;
}
```

## What to do

### 1. Create `src/lib/cc-db.ts`
- Opens a **read-only** connection to `~/.openclaw/control-center.db`
- Provides query functions: `getIssues()`, `getIssue(id)`, `getProjects()`, `getIssueComments(issueId)`
- Use `better-sqlite3` (already in MC's deps)
- DB path: use env var `CC_DB_PATH` with default `~/.openclaw/control-center.db`

### 2. Modify `src/app/api/tasks/route.ts`
- **GET**: Read from `control-center.db` `issues` table instead of MC's `tasks` table
- Map our fields to MC's Task interface:
  - `id` (TEXT) → keep as string (update Task interface to accept string ids)
  - `status`: `idea` → `inbox`, `proposal` → `assigned`, `todo` → `in_progress`, `done` → `done`
  - `priority`: `normal` → `medium` (direct map otherwise)
  - `assignee` → `assigned_to`
  - `project_id` → put in `metadata` JSON with project title
  - `created_at`/`updated_at` (ISO strings) → convert to unix timestamps
  - `archived=1` → filter out by default
- Support query params: `status`, `assigned_to`, `priority`, `limit`, `offset`
- **POST**: Create issue in `control-center.db` (need write access for this)
- **PUT**: Update issue status in `control-center.db`

### 3. Modify `src/app/api/tasks/[id]/comments/route.ts`
- GET: Read from `issue_comments` table
- POST: Write to `issue_comments` table

### 4. Modify `src/app/api/tasks/[id]/route.ts`
- GET/PUT/DELETE: Operate on `issues` table

### 5. Update the Task TypeScript interface
- Change `id` from `number` to `number | string`
- Add `project_id?: string` and `project_title?: string`

### 6. Add `CC_DB_PATH` to `.env`
```
CC_DB_PATH=/Users/cripto/.openclaw/control-center.db
```

## Important
- Do NOT delete or modify MC's original `tasks` table or migration — just stop using it for reads/writes
- The `control-center.db` is also used by other processes — be careful with write locks
- Use WAL mode for the connection
- **Test that the task board UI loads with our data after changes**
- Run `pnpm build` to verify no type errors

## Sample data
Projects: `notion-userboy-board` (📋), `Digital Garden` (🌱), `openclaw-updates` (🦞), `hardware-research` (🖥️)
Issues: 34 total — 13 idea, 16 todo, 5 done
