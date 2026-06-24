# Agent Integration Guide — Mission Control

How to wire an AI agent to work with Mission Control and auto-sync task status.

## Overview

Agents work best when they:
1. **Have MC MCP registered** — can call MC tools from Claude Code
2. **Poll for assigned tasks** — check for new work periodically
3. **Execute work** — do the actual task
4. **Auto-update status** — call `mc_update_task()` to sync back to the board

**Result:** Tasks flow through the board automatically. No manual status updates.

---

## Setup (One-Time)

### 1. Register Mission Control MCP

In your agent's directory, add the MC MCP server:

```bash
cd ~/<agent>/
claude mcp add mission-control -- node /path/to/mission-control/scripts/mc-mcp-server.cjs
```

Configure via `.env`:

```bash
MC_URL=http://127.0.0.1:3000  # or https://mc.str-agents.com for VPS
MC_API_KEY=<your-api-key>
```

Verify tools are available:

```bash
claude --mcp-list | grep mission-control
```

You should see tools like `mc_get_task`, `mc_list_agents`, `mc_update_task`, etc.

---

## Pattern: Poll → Execute → Update

### Initialize (once per session)

```typescript
// Load MC tools
import { execSync } from 'child_process'
const mcTools = await loadMCTools()

// Identify yourself
const ME = process.env.AGENT_NAME || 'leo'
```

### Main Loop

```typescript
async function runAgent() {
  console.log(`\n[${ME}] Checking for assigned work...`)
  
  // 1️⃣ Fetch tasks assigned to you that are not yet in progress
  const { tasks } = await mcTools.mc_list_tasks({
    assigned_to: ME,
    status: 'assigned',
    limit: 10,
  })
  
  if (!tasks.length) {
    console.log(`[${ME}] No work assigned. Next check in 5m.`)
    return
  }
  
  // 2️⃣ For each task, execute and update
  for (const task of tasks) {
    await executeTask(task)
  }
}

async function executeTask(task) {
  const { id, title, description } = task
  
  console.log(`\n[${ME}] Starting: ${title} (ID: ${id})`)
  
  // 3️⃣ Mark as in-progress
  await mcTools.mc_update_task({
    id,
    status: 'in_progress',
    comment: `Started by ${ME}`,
  })
  
  try {
    // 4️⃣ Do the actual work (call your business logic)
    const result = await yourWorker(title, description)
    
    // 5️⃣ Mark as done with results
    await mcTools.mc_update_task({
      id,
      status: 'done',
      comment: `Completed: ${result.summary}`,
    })
    
    console.log(`[${ME}] ✅ Done: ${title}`)
  } catch (err) {
    // 6️⃣ On error, update with details
    await mcTools.mc_update_task({
      id,
      status: 'awaiting_owner',  // Hand back to Gerda
      comment: `Error: ${err.message}`,
    })
    
    console.error(`[${ME}] ❌ Error: ${err.message}`)
  }
}
```

### Run on Schedule

**Option A: Continuous polling** (agent runs forever, checks every 5m)

```bash
# In agent's startup script:
node ~/leo/index.js &
```

Monitor via `pm2` or `systemctl`.

**Option B: Cron-based** (check on a schedule, e.g., weekly)

```bash
# In crontab (run once per week):
0 9 * * MON cd ~/leo && node index.js
```

---

## Status Transitions

Tasks flow through columns as you call `mc_update_task()`:

| Status | Column | What to do |
|--------|--------|-----------|
| `assigned` | Up Next | Waiting for you to call `in_progress` |
| `in_progress` | In Progress | You're working on it |
| `awaiting_owner` | Waiting | Blocked on something; hand back to Gerda |
| `review` | Review | Done but needs human approval |
| `done` | Done (This Week) | ✅ Complete |

---

## Example: Full Agent Template

See `~/mission-control/scripts/agent-template.js` for a complete working example you can copy and adapt.

Key parts:
- MCP tool initialization
- Task polling loop
- Error handling
- Comment posting

---

## Common Patterns

### 1. Post Progress Comments (Don't Wait for Done)

While working on a task, post updates so Gerda can see progress:

```typescript
await mcTools.mc_update_task({
  id,
  comment: `✓ Scanned 50 properties | ⏳ Processing matching rules...`,
  // Don't change status yet
})
```

### 2. Link Subtasks

Create work-in-progress subtasks that show up as child rows:

```typescript
const { task: subtask } = await mcTools.mc_create_task({
  title: `[${title}] Step 1: Validate data`,
  parent_task_id: parentId,
  status: 'assigned',
  assigned_to: ME,
})
```

### 3. Attach Evidence

Post links, screenshots, or reports as attachments:

```typescript
await mcTools.mc_create_attachment({
  task_id: id,
  url: 'https://docs.google.com/spreadsheets/d/...',
  label: 'Matched properties sheet',
})
```

### 4. Hand Off to Another Agent

If your work requires someone else, move it to their queue:

```typescript
await mcTools.mc_update_task({
  id,
  assigned_to: 'iris',  // Reassign to Iris
  status: 'assigned',
  comment: `Data ready for QA. Assigned to @iris.`,
})
```

---

## Debugging

**Task not showing up in my list?**

Check that you're assigned:

```bash
curl http://127.0.0.1:3000/api/tasks?assigned_to=leo&status=assigned
```

**Update not appearing on the board?**

Check MC logs:

```bash
tail -f ~/.mission-control/logs.txt
```

Or query directly:

```bash
curl http://127.0.0.1:3000/api/tasks/<id>
```

---

## Rollout

**Phase 1 (done):**
- ✅ MC MCP tools defined
- ✅ Task API stable
- ✅ Board UI live

**Phase 2 (in progress):**
- Atlas, Sofia, James integrate (test the pattern)
- Document common blockers
- Refine status transitions based on feedback

**Phase 3 (next):**
- All agents polling
- Auto-dispatch flows working
- Board becomes the single source of truth (Asana sunset)

---

## Questions?

- **MC API details?** See `/docs/api.md` or run `pnpm mc help`.
- **Agent not picking up tasks?** Check that `MC_API_KEY` matches and MC is running.
- **Rate limits?** MC is unrestricted for your fleet. Call as often as needed.
