# OpenClaw 运行时与控制平面集成方案

> **状态**: ✅ 已实现 (4个阶段全部完成)  
> **最后更新**: 2026-04-03  
> **实现分支**: `feat/openclaw-runtime-adapter`

## 现状分析

### 已完成的 7 个 API 端点

| 端点 | 功能 | 与控制平面关系 |
|------|------|---------------|
| `POST /api/runtime/openclaw/dispatches/{id}/claim` | 领取任务分派 | ✅ 已集成 `task-dispatch.ts` |
| `GET /api/runtime/openclaw/execution-tasks/{id}` | 获取执行快照 | ✅ 只读，无副作用 |
| `POST /api/runtime/openclaw/heartbeat` | 节点心跳 | ✅ 已写入 `agents` 表 |
| `POST /api/runtime/executions/{runId}/progress` | 进度上报 | ✅ 触发 `run.updated` 事件 |
| `POST /api/runtime/executions/{runId}/submit` | 结果提交 | ✅ 驱动任务状态流转 |
| `POST /api/runtime/executions/{runId}/cancel` | 取消执行 | ✅ 同步任务状态机 |
| `GET /api/runtime/executions/{runId}` | 查询状态 | ✅ 只读 |

**核心问题**: ✅ 已解决 - OpenClaw 运行时 API 与 Mission Control 任务生命周期已集成。

## 实现状态

| 阶段 | 内容 | 状态 | Commit |
|------|------|------|--------|
| Phase 1 | 元数据契约 + 基础状态流转 | ✅ 完成 | `feat(openclaw): integrate with task lifecycle` |
| Phase 2 | 调度集成 (task-dispatch.ts) | ✅ 完成 | `feat(task-dispatch): add OpenClaw runtime dispatch` |
| Phase 3 | 进度实时推送 (事件总线) | ✅ 完成 | `feat(openclaw): add progress event broadcasting` |
| Phase 4 | 端到端测试 | ✅ 完成 | `test(openclaw): add end-to-end integration tests` |

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

## 产品决策（已确定）

| 问题 | 决策 | 实现 |
|------|------|------|
| 任务如何标记为 OpenClaw 类型？ | **B. metadata.runtime_type** | `isOpenClawTask()` 检查 `metadata.runtime_type === 'openclaw'` |
| submit 成功后进入什么状态？ | **A. review（默认）** | 成功执行后进入 `review` 状态，等待人工/Aegis 审核 |
| 失败重试几次？ | **A. 固定 3 次** | `MAX_TASK_RETRIES = 3`，超过后进入 `failed` 状态 |
| 是否必须创建 task_dispatches 表？ | **A. 先用 metadata** | 使用 `tasks.metadata` 存储关联信息，未新建独立表 |

## 实施建议（已更新）

### ✅ Phase 1：元数据契约 + 基础状态流转（已完成）

- [x] 定义 `OpenClawTaskMetadata` 类型
- [x] 修改 `submitExecutionResult` 驱动任务状态流转
- [x] 添加 `task.status_changed` 事件广播

### ✅ Phase 2：调度集成（已完成）

- [x] 扩展 `task-dispatch.ts` 支持 OpenClaw 运行时分支
- [x] 实现 `isOpenClawTask()` 检测逻辑
- [x] 实现 `dispatchOpenClawTask()` 函数
- [ ] ~~创建 `task_dispatches` 表~~ (使用 metadata 替代)

### ✅ Phase 3：进度实时推送（已完成）

- [x] 修改 `recordExecutionProgress` 发布 `run.updated` 事件
- [x] 每 20% 进度触发 `task.updated` 事件

### ✅ Phase 4：端到端测试（已完成）

- [x] 完整流程测试：任务创建 → 调度 → claim → progress → submit → review
- [x] 重试逻辑测试：3次失败 → failed 状态
- [x] 取消执行测试：cancelled → assigned (可重试)

### ✅ Runtime API 收口检查（已完成）

- [x] `POST /api/runtime/openclaw/dispatches/{id}/claim`
- [x] `GET /api/runtime/openclaw/execution-tasks/{id}`
- [x] `POST /api/runtime/openclaw/heartbeat`
- [x] `POST /api/runtime/executions/{runId}/progress`
- [x] `POST /api/runtime/executions/{runId}/submit`
- [x] `POST /api/runtime/executions/{runId}/cancel`
- [x] `GET /api/runtime/executions/{runId}`
- [x] 聚焦测试 + 全量 vitest + typecheck 验证通过

### 下一批建议（最小增量）

当前主线接口已经闭环，下一批不建议再扩展新的运行时写接口，而是优先补齐 **submit 后处理能力**，范围控制在“结果消费”而不是“执行控制”。

建议顺序：

1. **自动验证结果持久化细化**
   - 在现有 `submitExecutionResult(...)` / `attachEval(...)` 基础上统一 `eval_result` 写入约定
   - 明确 `auto_validate` 开启时的结果结构、失败语义、UI 展示字段
   - 保持复用现有 `runs` / `activities` / `audit_log`，不新增大表

2. **产物（artifacts）读取面而非上传面**
   - 先补充对 submit 已写入 artifacts 的查询/展示契约
   - 暂不做二次上传接口，避免把对象存储和文件生命周期管理提前带进来

3. **Review / validator 闭环对齐**
   - 将 OpenClaw 成功提交后的 `review` / `quality_review` 路径与现有审核流文档化并补测试
   - 若需要 validator，优先作为 submit 后同步/异步消费步骤接入，而不是新增一套运行时协议

明确暂缓：
- 新增 OpenClaw artifacts 上传接口
- 新增独立 validator 结果表
- 新增新的 runtime control endpoint
- 再造一套与 `runs` 平行的执行状态模型


## 总结

OpenClaw API 已从"运行时能力层"升级为与 Mission Control "控制平面"完全集成的解决方案。

**4个集成点已全部实现：**

1. ✅ **元数据契约** — `runtime_type: 'openclaw'` 标识任务类型
2. ✅ **调度集成** — `task-dispatch.ts` 自动路由 OpenClaw 任务
3. ✅ **状态机集成** — submit 自动驱动任务状态流转
4. ✅ **事件集成** — progress/submit 发布事件总线，支持实时更新

**测试覆盖**: 969 个测试全部通过，包括 5 个 E2E 集成测试。
