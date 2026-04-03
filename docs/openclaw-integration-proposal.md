# OpenClaw 运行时与控制平面集成方案

## 现状分析

### 已完成的 7 个 API 端点

| 端点 | 功能 | 与控制平面关系 |
|------|------|---------------|
| `POST /openclaw/dispatches/{id}/claim` | 领取任务分派 | ❌ 独立运行，未接入 `task-dispatch.ts` |
| `GET /openclaw/execution-tasks/{id}` | 获取执行快照 | ✅ 只读，无副作用 |
| `POST /openclaw/heartbeat` | 节点心跳 | ✅ 已写入 `agents` 表 |
| `POST /executions/{runId}/progress` | 进度上报 | ❌ 未触发事件总线 |
| `POST /executions/{runId}/submit` | 结果提交 | ❌ 未驱动任务状态流转 |
| `POST /executions/{runId}/cancel` | 取消执行 | ❌ 未同步任务状态机 |
| `GET /executions/{runId}` | 查询状态 | ✅ 只读 |

**核心问题**：OpenClaw 运行时 API 与 Mission Control 任务生命周期完全解耦。

---

## 集成方案

### 1. 任务元数据契约（标识 OpenClaw 任务）

**现状**：`task-dispatch.ts` 通过 `target_session` metadata 路由到特定会话，但没有区分 OpenClaw 运行时任务。

**方案**：

```typescript
// tasks.metadata JSON 结构
interface OpenClawTaskMetadata {
  // 运行时类型标识
  runtime_type: 'openclaw'
  
  // OpenClaw 特有配置
  openclaw: {
    // 关联的 dispatch_id（claim 后回填）
    dispatch_id?: number
    
    // 执行会话信息
    runtime_session_id?: string
    runtime_node_id?: string
    
    // 执行运行 ID（runs.id）
    run_id?: string
    
    // 任务实现目标（复用现有 task-routing.ts）
    implementation_repo?: string
    code_location?: string
    
    // 执行策略
    strategy?: 'claim_then_execute' | 'direct_dispatch'
    
    // 进度上报配置
    progress_interval?: number  // 进度上报间隔（秒）
    
    // 自动验证配置
    auto_validate?: boolean
  }
}
```

**任务标记方式**：

```typescript
// 创建 OpenClaw 任务时
const task = {
  title: 'Build landing page',
  assigned_to: 'openclaw-builder',
  metadata: JSON.stringify({
    runtime_type: 'openclaw',
    openclaw: {
      implementation_repo: 'builderz-labs/mission-control',
      code_location: '/src/app',
      strategy: 'claim_then_execute',
      auto_validate: true
    }
  })
}
```

---

### 2. 调度集成点（task-dispatch.ts 扩展）

**现状**：`dispatchAssignedTasks()` 支持两种模式：
1. Direct Claude API（无网关）
2. OpenClaw Gateway（`runOpenClaw()`）

**问题**：没有针对 "OpenClaw 运行时任务" 的专门调度路径。

**方案**：新增 OpenClaw 运行时调度分支

```typescript
// src/lib/task-dispatch.ts

async function dispatchOpenClawTask(task: DispatchableTask): Promise<DispatchResult> {
  const metadata = parseOpenClawMetadata(task.metadata)
  
  // 1. 创建 runs 记录
  const run = createRun({
    agent_id: task.agent_name,
    task_id: String(task.id),
    status: 'pending',
    trigger: 'scheduler',
    metadata: {
      openclaw: {
        strategy: metadata.strategy,
        implementation_repo: metadata.implementation_repo,
        code_location: metadata.code_location
      }
    }
  }, task.workspace_id)
  
  // 2. 创建 task dispatch
  const dispatch = createTaskDispatch({
    task_id: task.id,
    agent_id: task.agent_id,
    run_id: run.id,
    workspace_id: task.workspace_id,
    status: 'pending'
  })
  
  // 3. 更新任务 metadata（回填 dispatch_id, run_id）
  updateTaskMetadata(task.id, {
    openclaw: {
      ...metadata,
      dispatch_id: dispatch.id,
      run_id: run.id
    }
  })
  
  // 4. 等待 OpenClaw 运行时 claim（异步）
  // 调度器不负责直接调用，而是等待运行时主动 claim
  // 超时逻辑由调度器的 requeueStaleTasks 处理
  
  return { type: 'openclaw_dispatched', run_id: run.id, dispatch_id: dispatch.id }
}

// 在 dispatchAssignedTasks() 中添加分支
export async function dispatchAssignedTasks(): Promise<DispatchResult> {
  // ... 现有代码 ...
  
  for (const task of tasks) {
    // 检测是否为 OpenClaw 运行时任务
    if (isOpenClawTask(task)) {
      await dispatchOpenClawTask(task)
      continue
    }
    
    // ... 现有调度逻辑（Direct API / Gateway）...
  }
}
```

---

### 3. 状态机集成（submit → 任务状态流转）

**现状**：任务状态流转
```
inbox → assigned → in_progress → review → quality_review → done
                              ↓
                            failed
```

**问题**：OpenClaw submit 后没有驱动任务状态流转。

**方案**：submit 回调中驱动任务状态

```typescript
// src/lib/openclaw-runtime.ts

export function submitExecutionResult(
  db: Database.Database,
  input: OpenClawSubmitRequest,
): OpenClawSubmitResult {
  // ... 现有逻辑 ...
  
  // 更新 run 状态
  updateRun(input.runId, { status: input.status, ... }, input.workspaceId)
  
  // ★ 新增：驱动关联任务的状态流转
  const taskId = getTaskIdFromRun(input.runId)
  if (taskId) {
    const task = getTask(taskId, input.workspaceId)
    
    if (input.status === 'completed' && input.outcome === 'success') {
      // 成功完成 → 进入 review 状态（等待人工/Aegis 审核）
      transitionTaskStatus(taskId, 'review', {
        resolution: input.result?.summary || 'Task completed via OpenClaw runtime',
        outcome: 'success',
        run_id: input.runId
      })
      
      // 添加评论记录执行结果
      addTaskComment(taskId, {
        author: task.assigned_to,
        content: formatExecutionResult(input),
        workspace_id: input.workspaceId
      })
    } else if (input.status === 'failed' || input.status === 'cancelled') {
      // 失败/取消 → 回到 assigned 重试，或失败
      const attempts = getDispatchAttempts(taskId)
      if (attempts >= MAX_RETRY) {
        transitionTaskStatus(taskId, 'failed', {
          error_message: input.error || 'Execution failed',
          outcome: 'failed'
        })
      } else {
        // 重试：回到 assigned
        transitionTaskStatus(taskId, 'assigned', {
          error_message: `Execution ${input.status}: ${input.error}. Will retry.`,
          dispatch_attempts: attempts + 1
        })
      }
    }
  }
  
  return result
}

// 辅助函数
function transitionTaskStatus(
  taskId: number,
  newStatus: TaskStatus,
  updates: Partial<Task>
) {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  
  db.prepare(`
    UPDATE tasks 
    SET status = ?, updated_at = ?, 
        resolution = COALESCE(?, resolution),
        outcome = COALESCE(?, outcome),
        error_message = COALESCE(?, error_message)
    WHERE id = ?
  `).run(newStatus, now, updates.resolution, updates.outcome, updates.error_message, taskId)
  
  // 触发事件
  eventBus.broadcast('task.status_changed', {
    id: taskId,
    status: newStatus,
    reason: 'openclaw_execution_complete'
  })
}
```

---

### 4. 事件总线集成（progress → 前端实时更新）

**现状**：`eventBus` 支持 `run.updated`, `run.completed` 等事件。

**问题**：OpenClaw progress 没有发布事件。

**方案**：progress 上报时发布事件

```typescript
// src/lib/openclaw-runtime.ts

export function recordExecutionProgress(
  db: Database.Database,
  input: OpenClawProgressRequest,
): OpenClawProgressResult {
  // ... 现有逻辑 ...
  
  // 更新 run metadata
  updateRun(input.runId, {
    metadata: { openclaw: openclawMetadata }
  }, input.workspaceId)
  
  // ★ 新增：发布进度事件
  eventBus.broadcast('run.updated', {
    run_id: input.runId,
    progress: input.progress,
    message: input.message,
    metrics: input.metrics,
    runtime_session_id: runtimeSessionId,
    source: 'openclaw'
  })
  
  // 可选：关联任务也收到进度更新
  const taskId = getTaskIdFromRun(input.runId)
  if (taskId && input.progress % 20 === 0) {  // 每 20% 更新一次
    eventBus.broadcast('task.updated', {
      id: taskId,
      execution_progress: input.progress,
      execution_message: input.message
    })
  }
  
  return result
}
```

---

### 5. 数据表设计（最小化新增）

**复用现有表**：
- `tasks` — 通过 `metadata.runtime_type = 'openclaw'` 标识
- `runs` — 已支持 `metadata.openclaw.*` 存储运行时信息
- `activities` — 已记录 `openclaw_claim`, `openclaw_submit` 等活动
- `audit_log` — 已记录审计事件

**新增表（仅当需要追踪 dispatch 状态时）**：

```sql
-- 可选：task_dispatches 表（如果需要在任务粒度追踪 dispatch 状态）
CREATE TABLE task_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  run_id TEXT,              -- 关联 runs.id
  workspace_id INTEGER NOT NULL,
  status TEXT NOT NULL,     -- pending | claimed | acked | completed | failed
  claimed_at INTEGER,
  claimed_by TEXT,          -- runtime_session_id
  completed_at INTEGER,
  result_outcome TEXT,      -- success | failure
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (run_id) REFERENCES runs(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX idx_task_dispatches_task ON task_dispatches(task_id);
CREATE INDEX idx_task_dispatches_status ON task_dispatches(status);
```

**建议**：第一阶段先用 `tasks.metadata` 存储 dispatch 关联，只有高频查询 dispatch 状态时才独立建表。

---

### 6. 完整执行流程

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 调度器 (scheduler)                                                │
│    - 扫描 assigned 状态的 OpenClaw 任务                              │
│    - 创建 runs 记录 (status: pending)                                │
│    - 创建 task_dispatches 记录 (status: pending)                     │
│    - 任务转入 in_progress 状态                                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. OpenClaw 运行时                                                   │
│    - 定期查询可领取的 dispatch                                       │
│    - 调用 POST /openclaw/dispatches/{id}/claim                      │
│    - dispatch 状态 → claimed                                         │
│    - 创建 run 记录（或由调度器预先创建）                              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. 执行期间                                                          │
│    - 定期 POST /executions/{runId}/progress                         │
│    - 发布 run.updated 事件 → 前端实时进度                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. 执行完成                                                          │
│    - POST /executions/{runId}/submit                                │
│    - 自动触发任务状态流转：                                           │
│      * success → task.status = review                               │
│      * failed  → task.status = assigned (重试) 或 failed            │
│    - 添加评论记录执行结果                                             │
│    - 发布 run.completed + task.status_changed 事件                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. 审核流程 (Aegis/人工)                                              │
│    - 若 review 通过 → done                                          │
│    - 若 review 拒绝 → assigned (带回退原因)                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 实施建议

### Phase 1：元数据契约 + 基础状态流转（1-2 天）

1. 定义 `OpenClawTaskMetadata` 类型
2. 修改 `submitExecutionResult` 驱动任务状态流转
3. 添加 `task.status_changed` 事件广播

### Phase 2：调度集成（2-3 天）

1. 扩展 `task-dispatch.ts` 支持 OpenClaw 运行时分支
2. 实现 `isOpenClawTask()` 检测逻辑
3. 实现 `dispatchOpenClawTask()` 函数
4. 可选：创建 `task_dispatches` 表

### Phase 3：进度实时推送（1 天）

1. 修改 `recordExecutionProgress` 发布 `run.updated` 事件
2. 前端组件订阅进度更新（如有需要）

### Phase 4：验证完整流程（1 天）

1. 端到端测试：任务创建 → 调度 → claim → progress → submit → review → done

---

## 需要产品决策的问题

| 问题 | 选项 | 影响 |
|------|------|------|
| 任务如何标记为 OpenClaw 类型？ | A. 特定 agent name（如 'openclaw-*'）<br>B. metadata.runtime_type<br>C. 新增 task.source 字段 | 影响 `isOpenClawTask()` 实现 |
| submit 成功后进入什么状态？ | A. review（当前默认）<br>B. quality_review（跳过人工初审）<br>C. 可配置 | 影响审核流程 |
| 失败重试几次？ | A. 固定 3 次<br>B. 任务级配置<br>C. 不重试直接失败 | 影响 `MAX_RETRY` 配置 |
| 是否必须创建 task_dispatches 表？ | A. 先用 metadata（简单）<br>B. 直接建表（规范） | 影响 Phase 2 工作量 |

---

## 总结

当前 OpenClaw API 实现了"运行时能力层"，但缺少与"控制平面"的集成点。本方案通过以下 4 个集成点实现完整闭环：

1. **元数据契约** — 标识 OpenClaw 任务
2. **调度集成** — `task-dispatch.ts` 路由到 OpenClaw 运行时
3. **状态机集成** — submit 驱动任务状态流转
4. **事件集成** — progress/submit 发布事件总线

**建议下一步**：确认上述 4 个产品决策问题，然后开始 Phase 1 实施。
