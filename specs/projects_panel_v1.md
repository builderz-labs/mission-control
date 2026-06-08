# Mission Control — Projects Panel v1 Spec

**Date:** 26 May 2026 (architecture amended 28 May)
**Status:** Draft — Gerda approved defaults 26 May, Jose builds Wk 2
**Owner:** Jose (v0 mock + MC integration) · Claude background agents (data wiring · BOOM Boards integration)
**Target deploy:** Mon 9 Jun 2026 (Wk 2 end)

---

## 1. Why this panel

Replace Asana as Gerda's primary visual surface for active project management. Subtasks YES, dependencies NO.

**28 May 2026 update:** Asana is now ARCHIVE-ONLY (see `memory/decision_asana_archive_only_28may.md`). This panel reads ACTIVE work from:
- **PRIMARY:** BOOM Boards (`/app/taskim/*`) — per-flat onboarding, ops projects
- **PRIMARY:** MC's own SQLite `tasks` + `projects` tables (decisions, agent work)
- **SECONDARY (read-only archive):** Asana via existing scanners — historical context only

NOT Asana-first anymore. Asana data still flows in but flagged as "archive · historical reference". New active work never lands in Asana from any agent.

## 2. User stories

- **Gerda:** "Show me every project the team is working on, who owns each, what's blocked." (Grid view)
- **Gerda:** "I have 15 minutes — what should I look at?" (Filter: assignee=me + status≠done + priority=P0|P1)
- **Jose:** "What does Feb have on her plate?" (Filter: assignee=Feb Albie U05KA5H4ELE)
- **Arianne:** "What's waiting on me for pricing approvals?" (Filter: assignee=Arianne U046NQS7PL3 + blocker_category=pricing_approvals)
- **Team:** "What did Iris/Sofia/Hugo do overnight?" (Filter: assignee_agent IN (iris, sofia, hugo) + updated_after=24h)

## 3. Data model (SQLite, MC-native at `/var/lib/docker/volumes/mission-control_mc-data`)

### `projects` table
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,          -- e.g. "EPL-MAINT-2026"
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  prefix TEXT NOT NULL,          -- e.g. "EPL-", "NN-", "UR-"
  workspace_id TEXT,             -- MC workspace, default "elite-property"
  owner_human TEXT,              -- Slack user_id of human owner
  owner_agent TEXT,              -- agent name (e.g. "hugo") if agent-owned
  asana_gid TEXT,                -- nullable: source GID during migration
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `tasks` table
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,                    -- e.g. "EPL-MAINT-2026-042"
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_task_id TEXT REFERENCES tasks(id),   -- NULL for top-level; SET for subtasks YES
  title TEXT NOT NULL,
  body_md TEXT,                           -- markdown body
  status TEXT NOT NULL CHECK (status IN ('inbox','assigned','in_progress','review','quality_review','done')),
  blocked BOOLEAN DEFAULT FALSE,          -- overlay flag, NOT a status
  priority TEXT CHECK (priority IN ('P0','P1','P2','P3')),
  assignee_human TEXT,                    -- Slack user_id
  assignee_agent TEXT,                    -- agent name from the 15
  due_date DATE,
  blocker_category TEXT,                  -- enum: pricing_approvals · reconciliation_disputes · forecast_inputs_missing · contract_signoff · landlord_decision · other
  asana_gid TEXT,                         -- nullable during migration
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX idx_tasks_status ON tasks(status, project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_human, assignee_agent);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
```

### `comments` table
```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  parent_comment_id TEXT REFERENCES comments(id),   -- for threaded
  author_human TEXT,
  author_agent TEXT,
  body_md TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_comments_task ON comments(task_id, created_at);
```

### `task_history` table (audit trail)
```sql
CREATE TABLE task_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,               -- human Slack ID or agent name
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_history_task ON task_history(task_id, changed_at);
```

### `task_attachments` table (added per Gerda 26 May)
```sql
CREATE TABLE task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL CHECK (type IN ('drive_link','sheet_link','boom_link','slack_link','asana_link','external_url','file_upload','photo','pdf')),
  url TEXT NOT NULL,                       -- the link or storage URI for uploaded files
  label TEXT,                              -- e.g. "Vauxhall lease 2024", "Damage photo by Fabian"
  mime_type TEXT,                          -- for file uploads
  size_bytes INTEGER,                      -- for file uploads
  added_by TEXT NOT NULL,                  -- human Slack ID or agent name
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_attachments_task ON task_attachments(task_id, added_at);
```

**Behaviour:**
- Paste any URL → MC auto-detects type (Drive doc, Sheet, BOOM listing, Slack thread, Asana task, external) and renders with appropriate icon + preview
- Drive/Sheet links show inline file preview (Google's iframe embed)
- BOOM listing link shows occupancy + ADR + next check-in inline (via `boom-mcp` aggregator)
- Slack thread link shows latest 3 messages inline
- File uploads stored on VPS volume `/var/lib/docker/volumes/mission-control_mc-data/_data/attachments/` for v1; migrate to S3 in v2 if volume > 10GB
- Agents (Hugo, Iris, Sofia) can attach evidence photos directly via `POST /api/tasks/<id>/attachments`

### NO `dependencies` table
Per Gerda 26 May: subtasks cover hierarchy. No Gantt charts.

## 4. Status workflow

```
inbox → assigned → in_progress → review → quality_review → done
                                                 ↘ blocked (overlay flag — red dot in current column)
                                                 ↘ cancelled (soft delete via status=done + blocked notes)
```

**Rules:**
- `inbox` is the default for new tasks (no assignee)
- `assigned` requires `assignee_human OR assignee_agent`
- `review` triggers Slack DM to the requester
- `quality_review` requires `assignee_human` (no agents — they don't QA)
- `done` requires `completed_at`
- `blocked` is an overlay (not a column) — red dot in the kanban card, shows in filtered "Blocked" view

## 5. UI shape

### 5.1 Kanban view (default landing)
6 columns matching the status enum. Drag-drop reorders within column. Drag across columns triggers status update.

**Swimlane toggles:**
- by Project (default — projects on the y-axis, statuses on the x-axis)
- by Assignee (rows = humans + agents, columns = statuses)

**Card displays:**
- Top row: project prefix + ID (e.g. `EPL-MAINT-042`)
- Title (1-2 lines)
- P-level chip (P0=red · P1=amber · P2=yellow · P3=grey)
- Assignee avatar (human Slack avatar OR agent icon — Sofia/James/Hugo/etc.)
- Subtask count badge (`3/8` if 3 of 8 subtasks done)
- Due date (red if overdue)
- Blocked red dot if `blocked=true`

### 5.2 Grid view (sortable table)
Columns: id · title · status · project · assignee · P · due · blocked · last activity. Saved filters per user. Export CSV.

### 5.3 Ticket detail drawer (slides in from right)
- Hero: title + status pill + transition buttons (status-aware)
- Body: markdown editor (live preview)
- Subtasks: inline checkboxes + drag-reorder + add-subtask button
- Comments: threaded, markdown, @-mentions
- History: audit trail (timestamped)
- AI buttons: `Ask Claude` · `Ask ChatGPT` (multi-LLM hook per panel YAML)
- Sidebar: project · assignee · P · due · blocker_category · last activity · related tasks

**Slides in — does NOT navigate away from board.** Background board stays in scroll position.

### 5.4 Filters bar (top)
- Status (multi-select)
- Project (multi-select)
- Assignee (humans + agents, multi-select, "me" shortcut)
- Priority (P0-P3)
- Due range
- Blocked yes/no
- Blocker category
- Saved views (per user)

### 5.5 Real-time multi-user
- WebSocket subscription on board view — when one user moves a card, others see it move within 1s
- Comments appear in real-time
- Optimistic UI for own actions

## 6. Asana migration

### Order (smallest → biggest)
1. **AI & Automations** `1213885425463677` — pilot
2. **Property Acquisition** `1208100038383799`
3. **Marketing** `1203640178184941`
4. **Finance** `1208253373143697`
5. **Legal** `1203640178185632`
6. **EPL** `1203637576513593` — biggest, last

### Migration script (Claude background agent owns)
Path: `~/mission-control/scripts/migrate_asana_to_mc.py`

For each Asana project:
1. Call Asana MCP `get_tasks` with `projects_any=<gid>` + `completed=false` (incomplete only — completed stays in Asana history)
2. Map Asana custom field `Agent` → MC `assignee_agent`
3. Map Asana section → MC status (configurable per project)
4. Map Asana subtask hierarchy → MC `parent_task_id`
5. POST to MC `/api/tasks` (one task at a time, log results)
6. Store original Asana GID in `tasks.asana_gid` for back-reference
7. Migrate comments + history if available

**Shadow project pattern:** for each Asana project, create MC project with `slug=<asana_slug>-shadow` first. Run parallel for 1 week. Gerda visually compares. When ✅, flip to `<asana_slug>` and mark Asana read-only.

### Status mapping per project (configurable)
```yaml
# scripts/migrations/ai-and-automations.yaml
asana_project_gid: "1213885425463677"
mc_project_slug: "ai-automations"
section_to_status:
  "Inbox": inbox
  "Todo": assigned
  "In Progress": in_progress
  "Review": review
  "Done": done
agent_field_gid: "<asana_custom_field_gid>"
```

## 7. API endpoints

```
GET    /api/projects                          List all projects (filtered by workspace)
POST   /api/projects                          Create project
GET    /api/projects/:id                      Project detail
GET    /api/projects/:id/tasks                Tasks in project (filtered)
GET    /api/tasks                             All tasks (filtered via query params)
POST   /api/tasks                             Create task
GET    /api/tasks/:id                         Task detail with comments + history
PATCH  /api/tasks/:id                         Update task (status, title, body, assignee, etc.)
POST   /api/tasks/:id/subtasks                Create subtask (sets parent_task_id)
POST   /api/tasks/:id/comments                Add comment
GET    /api/tasks/:id/history                 Audit trail
POST   /api/tasks/:id/ai-action               Invoke LLM (Claude or ChatGPT per panel YAML)
WS     /ws/projects/:id                       Real-time updates
```

## 8. Multi-LLM config

`/opt/mission-control/config/panels/projects.yaml`:

```yaml
panel: projects
default_llm: claude
allow_user_override: true
llms:
  claude:
    provider: anthropic
    model: claude-opus-4-7
    api_key_env: ANTHROPIC_API_KEY
    use_for:
      - summarise_task
      - draft_comment
      - generate_subtasks
      - estimate_effort
  chatgpt:
    provider: openai
    model: gpt-4o
    api_key_env: OPENAI_API_KEY
    use_for:
      - quick_rewrite
      - translate
      - polish_comment
budget_cap_monthly_gbp: 40
log_to_table: panel_llm_calls
```

## 9. Acceptance criteria (Wk 2 end — Mon 9 Jun)

- [ ] Projects panel deployed at `mc.str-agents.com/projects`
- [ ] Kanban view loads in <500ms with 100 tasks
- [ ] Grid view sortable + filterable + CSV export works
- [ ] Ticket detail drawer slides in without navigation
- [ ] Subtasks render inline with checkboxes + drag-reorder
- [ ] 3 pilot Asana projects migrated (AI & Auto · Property Acq · Marketing)
- [ ] Multi-LLM panel YAML works — `Ask Claude` returns response in <10s
- [ ] Real-time multi-user — 2 browsers see drag-drop within 1s
- [ ] Mobile-responsive (Fabian opens on phone, sees his assigned list)

## 10. Build order for Jose

**Day 1 (Mon 2 Jun):**
- **Emergent** mock — Kanban + Grid + Ticket detail drawer (60 min iteration target)
- Export React code
- Set up local `~/mission-control/` clone, run `pnpm dev`

**Day 2 (Tue):**
- Adapt Emergent output to MC conventions (`src/components/panels/projects.tsx`)
- Wire `useQuery` hooks to `/api/tasks` (stubbed initially)
- Register panel in MC's `[[...panel]]` route

**Day 3 (Wed):**
- Schema migration to SQLite (4 tables above)
- API endpoints (Claude background agent can pair on backend)
- Stub data seeded for testing

**Day 4 (Thu):**
- Asana migration script (Claude background agent owns, Jose reviews)
- 3 pilot projects shadow-migrated
- Gerda visually verifies parity

**Day 5 (Fri):**
- Multi-LLM YAML wired
- `Ask Claude` / `Ask ChatGPT` buttons functional
- Real-time WebSocket layer
- Deploy to VPS

**Mon 9 Jun:** LIVE — Gerda + team use it.

## 11. Dependencies on other Wk 1 work

- ✅ Architecture LOCKED (`project_visual_layer_architecture_26may.md`)
- ✅ MC live + 15 agents registered
- ⏳ Jose ramp (Slack DM landed, awaiting his start)
- ⏳ Agent self-register patch (Claude background, Wk 1)
- ⏳ Multi-LLM YAML scaffold (Claude background, Wk 1)
- ⏳ Properties Excel URL (Gerda paste — only blocks Properties panel, NOT Projects)

## 12. Open questions for Jose (resolve before Day 1)

1. ~~v0 vs Emergent vs Bolt~~ — **DECIDED: Emergent.** Per `GERDA_NORTH_STAR.md` "Jose explores Emergent."
2. Supabase or stay SQLite for projects data? Recommend SQLite (matches MC default, simpler).
3. WebSocket library — use MC's existing or add `socket.io`? Check what builderz-labs ships.
4. Mobile breakpoint — is 768px right? Confirm with Fabian's device.

---

**Sign-off:** Gerda approved defaults 26 May. Jose owns build Wk 2. Claude background owns data wiring + Asana migration. Mon 9 Jun = LIVE.
