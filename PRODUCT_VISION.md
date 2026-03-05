# Jarvis HQ — Product Vision
_Author: Arif Khan | Date: March 6, 2026_

## What Jarvis HQ IS
A **task-centric command center** where projects and tasks are the primary view. Agents are workers who pick up, execute, and hand off work. Jarvis is the orchestrator who ensures nothing falls through the cracks.

## What Jarvis HQ is NOT
- Not a monitoring dashboard (that's secondary)
- Not a virtual office gimmick
- Not just a log viewer

## Core Concept

### Tasks & Projects are Central
- The **default view is a task board** (Kanban or list), not the virtual office
- Projects group related tasks (e.g., "Home Away Launch", "Health Plan", "Mission Inbox")
- Each task has: title, description, assignee (agent), status, priority, blockers, due date
- Tasks can be created by Arif OR by agents themselves
- Tasks trace back to a project/goal

### Agents Assign Work to Each Other
- Any agent can create a task and assign it to another agent
- Example: Jarvis reviews Scout's research → creates a task for Zayd: "Evaluate these 3 properties"
- Example: Dev finds a bug → creates a task for himself or flags it for Jarvis to triage
- Assignment creates a notification/event the receiving agent picks up

### Orchestrator Pattern (Jarvis as Team Lead)
- A cron/heartbeat runs periodically (every 15-30 min)
- It checks: **are there pending tasks with no blockers?**
- If yes: Jarvis talks to the assigned agent via `sessions_send` and says "you have work to do"
- The agent picks up the task, executes, updates status
- If blocked: Jarvis escalates to Arif or tries to unblock

### Simple Flow
```
Task Created (by Arif or Agent)
  → Assigned to Agent
  → Status: TODO
  → Heartbeat picks it up
  → Jarvis sends task to Agent via sessions_send
  → Agent works on it
  → Agent updates status: IN PROGRESS → DONE (or BLOCKED)
  → If BLOCKED: Jarvis triages
  → If DONE: Jarvis reviews if needed, marks complete
```

## Views (Priority Order)

### 1. Task Board (DEFAULT VIEW)
- Kanban: Inbox → Todo → In Progress → Review → Done
- Filter by: agent, project, priority, status
- Quick-create task with assignee
- Drag and drop to reassign/reprioritize

### 2. Agent Status (Secondary)
- Simple list: Agent name, emoji, current task (or "idle"), last active
- Click agent → see their task history, current work, recent outputs
- Green/Yellow/Red status: Working / Idle / Error

### 3. Projects
- Group tasks by project
- Progress bar (X of Y tasks done)
- Standing projects: Health, Wealth, Relocation, Home Away, Mission Inbox, SukukLabs

### 4. Activity Feed
- Timeline of what happened: task created, status changed, agent output, blockers raised
- Filterable by agent/project

## Agent Integration

### How Agents Interact with Tasks
Agents use the task API (or a simple CLI/tool) to:
- `task list --mine` — see my assigned tasks
- `task update <id> --status in-progress` — claim a task
- `task update <id> --status done --output "..."` — mark complete with output
- `task create --title "..." --assignee dev --project "Home Away"` — create for another agent
- `task block <id> --reason "Need API key"` — flag a blocker

### Orchestrator Heartbeat
```
Every 15 minutes:
1. Query: tasks WHERE status=TODO AND blockers=0 AND assignee IS NOT NULL
2. For each: sessions_send(agentId, "You have a pending task: {title}. Task details: {description}. Please work on this and update status.")
3. Query: tasks WHERE status=BLOCKED
4. For blocked: Notify Arif or attempt to resolve
5. Query: tasks WHERE status=IN_PROGRESS AND last_updated > 2 hours ago
6. For stale: Ping agent "Status update on {title}?"
```

## What Already Exists in Mission Control
- ✅ Task board with Kanban (6 columns)
- ✅ Agent management
- ✅ Session tracking
- ✅ Gateway WebSocket connection
- ✅ API for tasks CRUD

## What Needs to Be Built
- [ ] Make task board the default/home view (not virtual office)
- [ ] Agent-to-agent task assignment via API
- [ ] Orchestrator heartbeat cron (check pending tasks, dispatch to agents)
- [ ] Task CLI/tool for agents to interact with tasks
- [ ] Project grouping
- [ ] Agent status derived from current task (idle = no active task)
- [ ] Standing projects auto-created (Health, Wealth, Relocation, etc.)
- [ ] Simple notification when task is assigned

## Non-Goals (For Now)
- No complex workflow/pipeline engine
- No budgets (yet)
- No org chart visualization (yet)
- No multi-tenant/workspace (we're single user)
