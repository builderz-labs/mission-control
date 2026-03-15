# GNAP Integration for Mission Control

## Overview

This library provides Git-Native Agent Protocol (GNAP) integration for Mission Control, enabling git-based task storage and collaboration.

## What is GNAP?

GNAP (Git-Native Agent Protocol) is a zero-infrastructure protocol for agent orchestration that uses git as the storage and transport layer. It enables:

- **Zero infrastructure**: No database, no server to deploy
- **Full audit trail**: Git history is your audit log
- **Offline capability**: Work disconnected, sync later
- **Multi-machine collaboration**: Shared repo across team
- **Human + AI agents**: Both are first-class participants

## Architecture

```
Mission Control Dashboard
    ↕ (sync engine)
GNAP git repo (.gnap/)
    ↕ git pull/push
Agent 1    Agent 2    Agent 3
```

## GNAP Structure

```
.gnap/
  version          # Protocol version
  agents.json      # Team registry
  tasks/           # Tasks as JSON files
  runs/            # Execution attempts
  messages/        # Agent messages
```

## Installation

The library is included in Mission Control. To enable GNAP:

1. Set environment variables:
```bash
GNAP_ENABLED=true
GNAP_REPO_PATH=/path/to/gnap/repo
GNAP_AUTO_SYNC=true
GNAP_SYNC_INTERVAL_SEC=300
GNAP_GIT_REMOTE=origin
GNAP_GIT_BRANCH=main
```

2. Configure git remote (optional):
```bash
cd /path/to/gnap/repo
git remote add origin https://github.com/your-org/gnap-repo.git
```

3. Restart Mission Control

## Usage

### Basic Example

```typescript
import {
  createGNAPRepo,
  createGNAPTaskManager,
  createGNAPAgentManager
} from '@/lib/gnap';

// Initialize repository
const repo = await createGNAPRepo({
  repoPath: '/path/to/gnap/repo',
  gitRemote: 'origin',
  gitBranch: 'main'
});

// Create task manager
const taskManager = createGNAPTaskManager(repo.repoPath);

// Create a task
await taskManager.createTask({
  id: 'TASK-1',
  title: 'Set up billing',
  assigned_to: ['agent-1'],
  state: 'backlog',
  priority: 0,
  created_by: 'admin',
  created_at: new Date().toISOString()
});

// Commit changes
await repo.push('Create billing task');
```

### Task Operations

```typescript
// Get task
const task = await taskManager.getTask('TASK-1');

// List all tasks
const tasks = await taskManager.listTasks();

// Filter tasks
const myTasks = await taskManager.filterTasks({
  assigned_to: 'agent-1',
  state: 'in_progress'
});

// Update task
task.state = 'done';
await taskManager.updateTask(task);

// Add comment
await taskManager.addComment('TASK-1', {
  by: 'admin',
  at: new Date().toISOString(),
  text: 'Great work!'
});

// Add tag
await taskManager.addTag('TASK-1', 'billing');
```

### Agent Operations

```typescript
import { createGNAPAgentManager } from '@/lib/gnap';

const agentManager = createGNAPAgentManager(repo.repoPath);

// Create agent
await agentManager.createAgent({
  id: 'agent-1',
  name: 'Research Agent',
  role: 'researcher',
  type: 'ai',
  status: 'active',
  runtime: 'openclaw',
  capabilities: ['research', 'analysis']
});

// Get agents
const agents = await agentManager.listAgents();

// Update status
await agentManager.updateAgentStatus('agent-1', 'busy');

// Get active agents
const activeAgents = await agentManager.getActiveAgents();
```

### Git Operations

```typescript
// Pull latest changes
await repo.pull();

// Push changes
await repo.push('Update tasks');

// Get status
const status = await repo.status();
console.log('Branch:', status.branch);
console.log('Has changes:', status.hasChanges);

// Get log
const log = await repo.log(10);
console.log('Recent commits:', log);

// Create branch for experiment
await repo.createBranch('experiment/my-feature');

// Merge branch
await repo.merge('experiment/my-feature');

// Resolve conflicts
if (await repo.hasConflicts()) {
  await repo.resolveConflicts('theirs');
}
```

## Schema Mapping

### SQLite ↔ GNAP

The library provides bidirectional mapping between Mission Control's SQLite schema and GNAP format.

**Task fields:**
| SQLite | GNAP | Notes |
|--------|------|-------|
| `id` | `id` | INTEGER → STRING |
| `status` | `state` | inbox→backlog, assigned→ready, etc. |
| `priority` | `priority` | low→3, medium→2, high→1, critical→0 |
| `assigned_to` | `assigned_to` | STRING → ARRAY |
| `created_at` | `created_at` | Unix → ISO 8601 |
| `tags` | `tags` | JSON string → ARRAY |

**Agent fields:**
| SQLite | GNAP | Notes |
|--------|------|-------|
| `id` | `id` | INTEGER → STRING |
| `status` | `status` | offline→terminated, error→paused |
| `session_key` | `runtime` | Maps to runtime type |
| `config` | `capabilities` | JSON → ARRAY |

## Configuration

### Environment Variables

```bash
# Enable GNAP
GNAP_ENABLED=true

# Repository path (default: {dataDir}/gnap)
GNAP_REPO_PATH=/path/to/gnap/repo

# Auto-sync configuration
GNAP_AUTO_SYNC=true
GNAP_SYNC_INTERVAL_SEC=300

# Git configuration
GNAP_GIT_REMOTE=origin
GNAP_GIT_BRANCH=main
```

### TypeScript Config

```typescript
import { gnap } from '@/lib/config';

const config: GNAPConfig = {
  repoPath: gnap.repoPath,
  enabled: gnap.enabled,
  autoSync: gnap.autoSync,
  syncIntervalSec: gnap.syncIntervalSec,
  gitRemote: gnap.gitRemote,
  gitBranch: gnap.gitBranch
};
```

## Task State Machine

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

## Best Practices

### Task Management

1. **Use descriptive IDs**: Use project prefixes (e.g., "PROJ-1", "BILL-1")
2. **Set appropriate priorities**: 0 = highest, 3 = lowest
3. **Add tags for organization**: Use tags like "billing", "urgent", "frontend"
4. **Assign clearly**: Only assign to agents that are active
5. **Use due dates**: Set deadlines for time-sensitive tasks

### Agent Management

1. **Define clear roles**: Use roles like "researcher", "developer", "analyst"
2. **Set capabilities**: List what the agent can do
3. **Update status**: Keep status accurate for proper load balancing
4. **Use heartbeat_sec**: Set appropriate poll intervals

### Git Workflow

1. **Pull before push**: Always pull before making changes
2. **Commit frequently**: Small, focused commits
3. **Use branches**: Branch for experiments or features
4. **Resolve conflicts**: Handle conflicts promptly
5. **Protect main branch**: Require pull requests for critical changes

### Sync Strategy

1. **Start with manual sync**: Test sync manually before auto-sync
2. **Monitor conflicts**: Watch for merge conflicts
3. **Backup first**: Always backup before major migrations
4. **Gradual rollout**: Test with small team first

## Troubleshooting

### Git Conflicts

**Problem**: Multiple agents updating same task simultaneously.

**Solution**:
```typescript
// Check for conflicts
if (await repo.hasConflicts()) {
  // Auto-resolve with "theirs" strategy
  await repo.resolveConflicts('theirs');
  await repo.push('Auto-resolved conflicts');
}
```

### Sync Failures

**Problem**: Sync engine fails to push/pull.

**Solution**:
```typescript
try {
  await repo.pull();
} catch (error) {
  // Log error and retry
  console.error('Pull failed:', error);
  // Wait and retry
  await new Promise(resolve => setTimeout(resolve, 5000));
  await repo.pull();
}
```

### Performance Issues

**Problem**: Too many tasks slowing down operations.

**Solution**:
- Archive old tasks to separate branch
- Use pagination for task lists
- Implement caching layer
- Consider sharding by project

### Missing Data

**Problem**: Task created but not appearing in list.

**Solution**:
```typescript
// Check if file exists
const task = await taskManager.getTask('TASK-1');
if (!task) {
  // Task not committed yet
  await repo.push('Create task');
}
```

## Migration

### From SQLite to GNAP

```typescript
import {
  createGNAPRepo,
  createGNAPTaskManager,
  createGNAPAgentManager
} from '@/lib/gnap';
import { getDatabase } from '@/lib/db';
import { mapSQLiteTaskToGNAP, mapSQLiteAgentToGNAP } from '@/lib/gnap/mapper';

const db = getDatabase();
const tasks = db.prepare('SELECT * FROM tasks').all();
const agents = db.prepare('SELECT * FROM agents').all();

const repo = await createGNAPRepo({
  repoPath: '/path/to/gnap/repo'
});

const taskManager = createGNAPTaskManager(repo.repoPath);
const agentManager = createGNAPAgentManager(repo.repoPath);

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

await repo.push('Migrate from SQLite to GNAP');
```

### Migration Script

Run the migration script:

```bash
npm run migrate-to-gnap
```

## API Reference

### GNAPRepo

| Method | Description |
|--------|-------------|
| `init()` | Initialize repository |
| `pull()` | Pull from remote |
| `push(message)` | Push to remote |
| `status()` | Get git status |
| `log(count)` | Get commit history |
| `checkout(branch)` | Checkout branch |
| `createBranch(branch)` | Create new branch |
| `merge(branch)` | Merge branch |
| `hasChanges()` | Check for uncommitted changes |
| `hasConflicts()` | Check for conflicts |
| `resolveConflicts(strategy)` | Resolve merge conflicts |
| `reset(commit?, hard?)` | Reset to previous commit |

### GNAPTaskManager

| Method | Description |
|--------|-------------|
| `getTask(id)` | Get task by ID |
| `listTasks()` | List all tasks |
| `filterTasks(filter)` | Filter tasks |
| `createTask(task)` | Create task |
| `updateTask(task)` | Update task |
| `deleteTask(id)` | Delete task |
| `updateTaskState(id, state, agentId)` | Update task state |
| `assignTask(id, agentId)` | Assign task to agent |
| `unassignTask(id, agentId)` | Unassign task from agent |
| `addComment(id, comment)` | Add comment to task |
| `addTag(id, tag)` | Add tag to task |
| `removeTag(id, tag)` | Remove tag from task |
| `getTasksForAgent(agentId)` | Get tasks for agent |
| `getTasksByState(state)` | Get tasks by state |
| `countTasksByState()` | Count tasks by state |
| `searchTasks(query)` | Search tasks |

### GNAPAgentManager

| Method | Description |
|--------|-------------|
| `getAgent(id)` | Get agent by ID |
| `listAgents()` | List all agents |
| `filterAgents(filter)` | Filter agents |
| `createAgent(agent)` | Create agent |
| `updateAgent(agent)` | Update agent |
| `deleteAgent(id)` | Delete agent |
| `updateAgentStatus(id, status)` | Update agent status |
| `getAgentsByStatus(status)` | Get agents by status |
| `getAgentsByType(type)` | Get agents by type |
| `getActiveAgents()` | Get active agents |
| `getAIAgents()` | Get AI agents |
| `getHumanAgents()` | Get human agents |
| `addCapability(id, capability)` | Add capability to agent |
| `removeCapability(id, capability)` | Remove capability from agent |
| `countAgentsByStatus()` | Count agents by status |
| `countAgentsByType()` | Count agents by type |
| `searchAgents(query)` | Search agents |

## Contributing

To add new GNAP features:

1. Add types to `types.ts`
2. Implement operations in appropriate file (task.ts, agent.ts, repo.ts)
3. Add mapper functions if needed (mapper.ts)
4. Update documentation
5. Add tests

## References

- [GNAP RFC](https://github.com/farol-team/gnap)
- [GNAP GitHub](https://github.com/farol-team/gnap)
- [Git Documentation](https://git-scm.com/doc)
- [Mission Control](https://github.com/builderz-labs/mission-control)

## License

MIT
