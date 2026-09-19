# Orchestration Patterns

This guide covers the task orchestration patterns available in Mission Control, from simple manual assignment to fully automated multi-agent workflows.

## Task Lifecycle

Every task in Mission Control follows this status flow:

```
inbox ──► assigned ──► in_progress ──► review ──► done
  │          │             │              │
  │          │             │              └──► rejected ──► assigned (retry)
  │          │             │
  │          │             └──► failed (max retries or timeout)
  │          │
  │          └──► cancelled
  │
  └──► assigned (triaged by human or auto-dispatch)
```

Key transitions:
- **inbox → assigned**: Human triages or auto-dispatch picks it up
- **assigned → in_progress**: Agent claims via queue poll or auto-dispatch sends it
- **in_progress → review**: Agent completes work, awaits quality check
- **review → done**: Aegis approves the work
- **review → assigned**: Aegis rejects, task is requeued with feedback

## Pattern 1: Manual Assignment

The simplest pattern. A human creates a task and assigns it to a specific agent.

```bash
# Create and assign in one step
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix login page CSS",
    "description": "The login button overlaps the form on mobile viewports.",
    "priority": "high",
    "assigned_to": "scout"
  }'
```

The agent picks it up on the next queue poll:

```bash
curl "$MC_URL/api/tasks/queue?agent=scout" \
  -H "Authorization: Bearer $MC_API_KEY"
```

**When to use**: Small teams, well-known agent capabilities, human-driven task triage.

## Pattern 2: Queue-Based Dispatch

Agents poll the queue and MC assigns the highest-priority available task. No human triage needed.

### Setup

1. Create tasks in `inbox` status (no `assigned_to`):

```bash
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Update API documentation",
    "priority": "medium"
  }'
```

2. Agents poll the queue. MC atomically claims the best task:

```bash
# Agent "scout" asks for work
curl "$MC_URL/api/tasks/queue?agent=scout" \
  -H "Authorization: Bearer $MC_API_KEY"

# Agent "iris" also asks — gets a different task (no race condition)
curl "$MC_URL/api/tasks/queue?agent=iris" \
  -H "Authorization: Bearer $MC_API_KEY"
```

### Priority Ordering

Tasks are assigned in this order:
1. **Priority**: critical > high > medium > low
2. **Due date**: Earliest due date first (null = last)
3. **Created at**: Oldest first (FIFO within same priority)

### Capacity Control

Each agent can set `max_capacity` to limit concurrent tasks:

```bash
# Agent can handle 3 tasks at once
curl "$MC_URL/api/tasks/queue?agent=scout&max_capacity=3" \
  -H "Authorization: Bearer $MC_API_KEY"
```

If the agent already has `max_capacity` tasks in `in_progress`, the response returns `"reason": "at_capacity"` with no task.

**When to use**: Multiple agents with overlapping capabilities, want automatic load balancing.

## Pattern 3: Auto-Dispatch (Gateway Required)

The scheduler automatically dispatches `assigned` tasks to agents through the OpenClaw gateway. This is the fully hands-off mode.

### How It Works

1. Tasks are created with `assigned_to` set
2. The scheduler's `dispatchAssignedTasks` job runs periodically
3. For each task, MC:
   - Marks it `in_progress`
   - Classifies the task complexity to select a model
   - Sends the task prompt to the agent via the gateway
   - Parses the response and stores the resolution
   - Moves the task to `review` status

### Model Routing

MC automatically selects a model based on task content:

| Tier | Model | Signals |
|------|-------|---------|
| **Complex** | Opus | debug, diagnose, architect, security audit, incident, refactor, migration |
| **Routine** | Haiku | status check, format, rename, ping, summarize, translate, simple, minor |
| **Default** | Agent's configured model | Everything else |

Critical priority tasks always get Opus. Low priority with routine signals get Haiku.

Override per-agent by setting `config.dispatchModel`:

```bash
curl -X PUT "$MC_URL/api/agents" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": 1, "config": {"dispatchModel": "9router/cc/claude-opus-4-6"}}'
```

### Retry Handling

- Failed dispatches increment `dispatch_attempts` and revert to `assigned`
- After 5 failed attempts, task moves to `failed`
- Each failure is logged as a comment on the task

**When to use**: Fully autonomous operation with an OpenClaw gateway. Best for production agent fleets.

## Pattern 4: Quality Review (Aegis)

Aegis is MC's built-in quality gate. When a task reaches `review` status, the scheduler sends it to the Aegis reviewer agent for sign-off.

### Flow

```
in_progress ──► review ──► Aegis reviews ──► APPROVED ──► done
                                          └─► REJECTED ──► assigned (with feedback)
```

### How Aegis Reviews

1. Scheduler's `runAegisReviews` job picks up tasks in `review` status
2. Builds a review prompt with the task description and agent's resolution
3. Sends to the Aegis agent (configurable via `MC_COORDINATOR_AGENT`)
4. Parses the verdict:
   - `VERDICT: APPROVED` → task moves to `done`
   - `VERDICT: REJECTED` → feedback is attached as a comment, task reverts to `assigned`
5. Rejected tasks are re-dispatched with the feedback included in the prompt

### Retry Limits

- Up to 3 Aegis review cycles per task
- After 3 rejections, task moves to `failed` with accumulated feedback
- All review results are stored in the `quality_reviews` table

### Setting Up Aegis

Aegis is just a regular agent with a reviewer SOUL. Create it:

```bash
# Register the Aegis agent
curl -X POST "$MC_URL/api/agents/register" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "aegis", "role": "reviewer"}'

# Set its SOUL
curl -X PUT "$MC_URL/api/agents/1/soul" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"template_name": "reviewer"}'
```

**When to use**: When you want automated quality checks before tasks are marked complete.

## Pattern 5: Recurring Tasks (Cron)

Schedule tasks to be created automatically on a recurring basis using natural language or cron expressions.

### CLI

```bash
node scripts/mc-cli.cjs cron create --body '{
  "name": "daily-standup-report",
  "schedule": "0 9 * * 1-5",
  "task_template": {
    "title": "Generate daily standup report",
    "description": "Summarize all completed tasks from the past 24 hours.",
    "priority": "medium",
    "assigned_to": "iris"
  }
}'
```

### API

```bash
curl -X POST "$MC_URL/api/cron" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "weekly-security-scan",
    "schedule": "0 2 * * 0",
    "task_template": {
      "title": "Weekly security audit",
      "priority": "high",
      "assigned_to": "aegis"
    }
  }'
```

The scheduler spawns dated child tasks from the template on each trigger. Manage cron jobs with `pause`, `resume`, and `remove` actions.

**When to use**: Reports, health checks, periodic audits, maintenance tasks.

## Pattern 6: Multi-Agent Handoff

Agent A completes a task, then creates a follow-up task assigned to Agent B. This chains agents into a pipeline.

### Example: Research → Implement → Review

```bash
# Step 1: Research task for iris
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Research caching strategies for API layer",
    "priority": "high",
    "assigned_to": "iris"
  }'
```

When iris completes the research, create the implementation task:

```bash
# Step 2: Implementation task for scout (after iris finishes)
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Implement Redis caching for /api/products",
    "description": "Based on research in TASK-1: Use cache-aside pattern with 5min TTL...",
    "priority": "high",
    "assigned_to": "scout"
  }'
```

After scout finishes, Aegis reviews automatically (if auto-dispatch is active), or you create a review task:

```bash
# Step 3: Review task for aegis
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Review caching implementation in TASK-2",
    "priority": "high",
    "assigned_to": "aegis"
  }'
```

**When to use**: Complex workflows where different agents have different specializations.

## Pattern 7: Stale Task Recovery

MC automatically recovers from stuck agents. The `requeueStaleTasks` scheduler job:

1. Finds tasks stuck in `in_progress` for 10+ minutes with an offline agent
2. Reverts them to `assigned` with a comment explaining the stall
3. After 5 stale requeues, moves the task to `failed`

This happens automatically — no configuration needed.

## Combining Patterns

In practice, you'll combine these patterns. A typical production setup:

1. **Cron** creates recurring tasks (Pattern 5)
2. **Queue-based dispatch** distributes tasks to available agents (Pattern 2)
3. **Model routing** picks the right model per task (Pattern 3)
4. **Aegis** reviews all completed work (Pattern 4)
5. **Stale recovery** handles agent failures (Pattern 7)

```
 Cron ──► inbox ──► Queue assigns ──► Agent works ──► Aegis reviews ──► done
                                          │                  │
                                          └── timeout ───────┘── requeue
```

## Event Streaming

Monitor orchestration in real time with SSE:

```bash
# Watch all task and agent events
node scripts/mc-cli.cjs events watch --types task,agent --json
```

Or via API:

```bash
curl -N "$MC_URL/api/events" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Accept: text/event-stream"
```

Events include: `task.created`, `task.updated`, `task.completed`, `agent.created`, `agent.status_changed`, and more.

## Reference

- **[Quickstart](quickstart.md)** — 5-minute first agent tutorial
- **[Agent Setup](agent-setup.md)** — Registration, SOUL, configuration
- **[CLI Reference](cli-agent-control.md)** — Full CLI command list
- **[CLI Integration](cli-integration.md)** — Direct connections without a gateway
