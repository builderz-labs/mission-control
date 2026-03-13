import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { runOpenClaw, runOpenClawDetached } from '@/lib/command'
import { getIssue, getTurns, setTaskPicked, getCCDatabase } from '@/lib/cc-db'

type DispatchParams = {
  taskId: string
  title: string
  assignee?: string
  reason: 'create' | 'reassign'
  content?: string
}

const PENDING_PATH = `${process.env.HOME}/.openclaw/dispatch-pending.json`
const retryTimers = new Map<string, NodeJS.Timeout>()

// Known agent IDs that can receive dispatches.
// Human assignees (cri, etc.) are NOT agents and should not be dispatched to.
const KNOWN_AGENTS = new Set([
  'main', 'cseno', 'cody', 'worm', 'ops', 'piem', 'ralph', 'pinball', 'uze', 'dumbo',
])

function resolveAgentId(assignee: string): string | null {
  const a = (assignee || '').trim().toLowerCase()
  if (!a) return null
  if (!KNOWN_AGENTS.has(a)) return null  // human assignee — skip
  if (a === 'cseno') return 'main'
  return a
}

/** Check if an assignee name maps to a known agent (for UI purposes) */
export function isAgentAssignee(assignee: string): boolean {
  return resolveAgentId(assignee) !== null
}

function withOpenClawEnv() {
  return {
    ...process.env,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH || `${process.env.HOME}/.openclaw/openclaw.json`,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR || `${process.env.HOME}/.openclaw`,
  }
}

function readPending(): Record<string, DispatchParams[]> {
  try {
    if (!existsSync(PENDING_PATH)) return {}
    return JSON.parse(readFileSync(PENDING_PATH, 'utf-8')) || {}
  } catch {
    return {}
  }
}

function writePending(data: Record<string, DispatchParams[]>) {
  try {
    writeFileSync(PENDING_PATH, JSON.stringify(data, null, 2))
  } catch {
    // best effort
  }
}

function enqueuePending(assignee: string, payload: DispatchParams) {
  const data = readPending()
  const key = assignee.toLowerCase()
  const list = data[key] || []
  // keep one latest nudge per task id to avoid spam
  const deduped = list.filter((x) => x.taskId !== payload.taskId)
  deduped.push(payload)
  data[key] = deduped
  writePending(data)
}

function popPending(assignee: string): DispatchParams[] {
  const data = readPending()
  const key = assignee.toLowerCase()
  const list = data[key] || []
  if (data[key]) {
    delete data[key]
    writePending(data)
  }
  return list
}

async function isLikelyBusy(assignee: string): Promise<boolean> {
  // Spawn agents always get fresh sessions — never considered busy
  const a = assignee.toLowerCase()
  if (SPAWN_AGENTS.has(a)) return false
  // Only guard persistent-session agents that might be mid-conversation
  if (a !== 'cody') return false

  try {
    const out = await runOpenClaw(['sessions', '--agent', a, '--json'], {
      timeoutMs: 8000,
      env: withOpenClawEnv(),
    })
    const parsed = JSON.parse(out.stdout || '{}')
    const sessions = parsed?.sessions || []
    const row = sessions.find((s: any) => s?.key === `agent:${a}:main`) || sessions[0]
    if (!row) return false
    const updatedAt = Number(row.updatedAt || 0)
    if (!updatedAt) return false
    return (Date.now() - updatedAt) < 5 * 60 * 1000
  } catch {
    // if uncertain, assume not busy (don't block dispatch forever)
    return false
  }
}

// Agents that use spawn (no persistent main session)
const SPAWN_AGENTS = new Set(['dumbo', 'uze', 'ralph', 'piem'])

async function sendOne(payload: DispatchParams) {
  const assignee = (payload.assignee || '').trim()
  const agentId = resolveAgentId(assignee)
  if (!agentId) return { sent: false as const, reason: 'no-agent' as const }

  const compactContext = (payload.content || '').replace(/\s+/g, ' ').trim().slice(0, 240)

  if (SPAWN_AGENTS.has(agentId)) {
    // Fetch full task data, mark as picked, and embed everything in the message.
    // Agent wakes up knowing everything — zero API calls needed to start working.
    const issue = getIssue(payload.taskId)
    if (!issue) {
      return { sent: false as const, reason: 'no-task' as const }
    }
    setTaskPicked(payload.taskId, agentId)
    const turns = getTurns(payload.taskId)

    const turnsBlock = turns.length > 0
      ? `## Prior turns\n\n${turns.map(t => `**[${t.type}] ${t.author}** (round ${t.round_number}):\n${t.content}`).join('\n\n---\n\n')}`
      : ''

        // Resolve project local path from the projects table
    let projectPath = ''
    if (issue.project_id) {
      const db = getCCDatabase()
      const proj = db.prepare('SELECT title, local_path FROM projects WHERE id = ?').get(issue.project_id) as any
      const localPath = proj?.local_path?.replace('~', process.env.HOME || '~')
      projectPath = `\n**Project:** ${proj?.title || issue.project_id}${localPath ? `\n**Project path:** \`${localPath}\` — cd here and work in this directory` : ''}`
    }

    // Team config — single source of truth for PM↔Builder routing
    const TEAMS: Record<string, { pm: string; builder: string }> = {
      skunkworks: { pm: 'ralph', builder: 'dumbo' },
      main:       { pm: 'piem',  builder: 'cody' },
    }
    const team = Object.values(TEAMS).find(t => t.pm === agentId || t.builder === agentId)
    const isPM = team ? team.pm === agentId : false
    const builderTarget = team?.builder || 'cody'
    const pmTarget = team?.pm || 'cri'
    // Builders report to their PM, PMs report to Cri, non-team agents report to Cri
    const resultTarget = team
      ? (isPM ? 'cri' : pmTarget)   // PM→cri, builder→pm
      : 'cri'

    let workflowBlock: string
    if (isPM) {
      workflowBlock = `## Your workflow (PM — fully autonomous)

### If this is a NEW task (no prior turns from ${builderTarget}):
1. Write a proper plan with acceptance criteria
2. Update the task description via PUT with your plan
3. Delegate to ${builderTarget} by posting a result turn:

\`\`\`bash
curl -s -X POST "http://localhost:3333/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: mc-api-key-local-dev" \\
  -d '{"type":"result","author":"${agentId}","assigned_to":"${builderTarget}","content":"Plan written. See task description for spec."}'
\`\`\`

### If this is a REVIEW (${builderTarget} posted a result turn):
1. cd into the project path and review the Git diff:
   \`git diff main..task/${payload.taskId.slice(0, 8)}\`
2. Run the build, run tests, verify against spec
3. If it **passes**: create a PR, then deliver to Cri with the PR link:

\`\`\`bash
cd <project_path>
gh pr create --base main --head task/${payload.taskId.slice(0, 8)} --title "${issue.title}" --body "Task: ${payload.taskId}"
\`\`\`

Then post:
\`\`\`bash
curl -s -X POST "http://localhost:3333/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: mc-api-key-local-dev" \\
  -d '{"type":"result","author":"${agentId}","assigned_to":"cri","content":"## Done\\n\\n### PR\\n<link>\\n\\nReviewed and approved."}'
\`\`\`

4. If it **fails**: send back with specific fixes (cite the diff):

\`\`\`bash
curl -s -X POST "http://localhost:3333/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: mc-api-key-local-dev" \\
  -d '{"type":"instruction","author":"${agentId}","assigned_to":"${builderTarget}","content":"Issues:\\n1. ..."}'
\`\`\``
    } else {
      const taskBranch = `task/${payload.taskId.slice(0, 8)}`
      workflowBlock = `## Git workflow (mandatory)

1. cd into the **project path** (see above) — NEVER work in your home directory
2. Create a feature branch:
\`\`\`bash
git checkout main && git pull
git checkout -b ${taskBranch}
\`\`\`
3. Implement the changes
4. Commit and push:
\`\`\`bash
git add -A && git commit -m "feat: <short description>"
git push -u origin ${taskBranch}
\`\`\`
5. Run the build to verify — fix any errors before reporting

## How to report back

When done, post a **result** turn (routes to **${resultTarget}**). Include the branch name:

\`\`\`bash
curl -s -X POST "http://localhost:3333/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: mc-api-key-local-dev" \\
  -d '{"type":"result","author":"${agentId}","assigned_to":"${resultTarget}","content":"## Done\\n\\n### Branch\\n\\\`${taskBranch}\\\`\\n\\n### Changes\\n- ...\\n\\n### Build\\nPassing"}'
\`\`\`

If you need clarification from Cri:

\`\`\`bash
curl -s -X POST "http://localhost:3333/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: mc-api-key-local-dev" \\
  -d '{"type":"instruction","author":"${agentId}","assigned_to":"cri","content":"Questions:\\n1. ..."}'
\`\`\``
    }

    const nudgeMsg = `# Task Assignment

**Task ID:** ${payload.taskId}
**Title:** ${issue.title}
**Priority:** ${issue.priority}${projectPath}

## Description

${issue.description || '(no description)'}

${turnsBlock}

${workflowBlock}

**Critical rules:**
- Work on THIS task (${payload.taskId}) — do NOT create new tasks.
- Never change task status — only post turns.
- After posting your turn, reply NO_REPLY to close your session.`

    // Force truly fresh session: cleanup gateway memory + delete session files
    const sessDir = `${process.env.HOME}/.openclaw/agents/${agentId}/sessions`
    try {
      // 1. Tell gateway to drop in-memory session state
      execSync(`openclaw sessions cleanup --agent ${agentId} --enforce`, {
        timeout: 5000, stdio: 'ignore', env: withOpenClawEnv() as any,
      })
    } catch { /* best-effort */ }
    try {
      // 2. Delete session transcript files
      for (const f of readdirSync(sessDir)) {
        if (f.endsWith('.jsonl') || f.endsWith('.lock') || f === 'sessions.json') {
          unlinkSync(`${sessDir}/${f}`)
        }
      }
    } catch { /* dir may not exist yet */ }

    runOpenClawDetached([
      'agent',
      '--agent', agentId,
      '--message', nudgeMsg,
    ], {
      env: withOpenClawEnv(),
    })
  } else {
    // Send to persistent main session
    const header = payload.reason === 'create' ? 'New task assigned' : 'Task reassigned to you'
    const msg = `${header} ${payload.taskId} | ${payload.title}${compactContext ? ` | ${compactContext}` : ''}. Open in Eden and start now.`

    await runOpenClaw(['agent', '--agent', agentId, '--message', msg], {
      timeoutMs: 20000,
      env: withOpenClawEnv(),
    })
  }

  return { sent: true as const, agentId }
}

function scheduleDrain(assignee: string) {
  const key = assignee.toLowerCase()
  if (retryTimers.has(key)) return

  const t = setTimeout(async () => {
    retryTimers.delete(key)
    try {
      if (await isLikelyBusy(key)) {
        scheduleDrain(key)
        return
      }
      const queued = popPending(key)
      for (const item of queued) {
        await sendOne(item)
      }
    } catch {
      scheduleDrain(key)
    }
  }, 60_000)

  retryTimers.set(key, t)
}

export async function dispatchTaskNudge(params: DispatchParams) {
  const assignee = (params.assignee || '').trim()
  if (!assignee) return { sent: false, reason: 'no-assignee' as const }

  if (await isLikelyBusy(assignee)) {
    enqueuePending(assignee, params)
    scheduleDrain(assignee)
    return { sent: false, reason: 'busy-queued' as const }
  }

  // Drain any previous queued nudges first, then send the current one
  const queued = popPending(assignee)
  for (const item of queued) {
    await sendOne(item)
  }

  return sendOne(params)
}
