import { getDatabase, db_helpers, logAuditEvent } from '@/lib/db'
import { getSchedulerStatus, triggerTask } from '@/lib/scheduler'
import type { OrchestratorControlActionResponse, OrchestratorControlState } from '@/types/mission-control'

const CONTROL_STATE_KEY = 'orchestrator.control_state'
const DISPATCH_KEY = 'general.orchestrator_dispatch'
const SCHEDULED_RUNS_KEY = 'general.scheduled_agent_runs'
const FALLBACK_KEY = 'general.groq_fallback'
const AUTONOMOUS_LOOP_KEY = 'general.autonomous_dev_loop'
const AUTO_SPAWN_KEY = 'orchestrator.auto_spawn_agents'
const DEBATE_KEY = 'orchestrator.agent_debate_enabled'
const SELF_HEAL_KEY = 'orchestrator.repo_self_heal'

const ORCHESTRATOR_TEAM_NAMES = new Set([
  'TechLead',
  'ChatGPT',
  'Gemini',
  'Kimi',
  'AmazonQ',
  'Ollama',
  'UIDesigner',
  'Groq',
  'Reviewer',
  'Review2',
  'Review3',
  'Review4',
])

type OrchestratorAction = OrchestratorControlActionResponse['action']

type SettingWrite = {
  key: string
  value: string
  description: string
  category?: string
}

type OrchestratorFeatureToggles = {
  autonomousLoopEnabled?: boolean
  autoSpawnEnabled?: boolean
  debateEnabled?: boolean
  selfHealEnabled?: boolean
}

function readSetting(key: string): string | null {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function writeSettings(settings: SettingWrite[], updatedBy: string) {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      description = excluded.description,
      category = excluded.category,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `)

  const tx = db.transaction(() => {
    for (const setting of settings) {
      stmt.run(
        setting.key,
        setting.value,
        setting.description,
        setting.category || 'orchestrator',
        updatedBy
      )
    }
  })

  tx()
}

function parseBool(value: string | null, fallback: boolean) {
  if (value == null) return fallback
  return value === 'true'
}

function getTeamAgents() {
  const db = getDatabase()
  const rows = db.prepare('SELECT id, name, status, config FROM agents ORDER BY name').all() as Array<{
    id: number
    name: string
    status: 'offline' | 'idle' | 'busy' | 'error'
    config: string | null
  }>

  return rows.filter((row) => {
    if (ORCHESTRATOR_TEAM_NAMES.has(row.name)) return true
    if (!row.config) return false
    try {
      const parsed = JSON.parse(row.config)
      return parsed?.team === 'orchestrator'
    } catch {
      return false
    }
  })
}

function getStoredControlState(activeRuns: number) {
  const stored = readSetting(CONTROL_STATE_KEY)
  if (stored === 'paused' || stored === 'stopped' || stored === 'running' || stored === 'idle') {
    return stored
  }
  return activeRuns > 0 ? 'running' : 'idle'
}

export function getOrchestratorControlState(): OrchestratorControlState {
  const schedulerTasks = getSchedulerStatus()
  const db = getDatabase()
  const activeRuns = (
    db.prepare("SELECT COUNT(*) as count FROM orchestrator_runs WHERE status = 'running'").get() as { count: number }
  ).count
  const dispatchEnabled = parseBool(readSetting(DISPATCH_KEY), true)
  const scheduledRunsEnabled = parseBool(readSetting(SCHEDULED_RUNS_KEY), true)
  const fallbackEnabled = parseBool(readSetting(FALLBACK_KEY), true)
  const autonomousLoopEnabled = parseBool(readSetting(AUTONOMOUS_LOOP_KEY), true)
  const autoSpawnEnabled = parseBool(readSetting(AUTO_SPAWN_KEY), true)
  const debateEnabled = parseBool(readSetting(DEBATE_KEY), true)
  const selfHealEnabled = parseBool(readSetting(SELF_HEAL_KEY), true)
  const autoSpawnedAgents = (
    db.prepare(`SELECT COUNT(*) as count FROM agents WHERE config LIKE '%"auto_spawned":true%'`).get() as { count: number }
  ).count
  const debatePendingTasks = (
    db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE metadata LIKE '%"debate_pending":true%'`).get() as { count: number }
  ).count
  const schedulerRunning = schedulerTasks.some((task) => (
    task.id === 'autonomous_dev_loop' ||
    task.id === 'orchestrator_dispatch' ||
    task.id === 'scheduled_agent_runs' ||
    task.id === 'groq_fallback'
  ) && task.running)
  const lastResult = schedulerTasks.find((task) => task.id === 'autonomous_dev_loop')?.lastResult?.message
    || schedulerTasks.find((task) => task.id === 'orchestrator_dispatch')?.lastResult?.message

  const derivedState = getStoredControlState(activeRuns)
  const state = derivedState === 'idle' && (dispatchEnabled || scheduledRunsEnabled || fallbackEnabled || activeRuns > 0)
    ? 'running'
    : derivedState

  return {
    state,
    dispatchEnabled,
    scheduledRunsEnabled,
    fallbackEnabled,
    autonomousLoopEnabled,
    autoSpawnEnabled,
    debateEnabled,
    selfHealEnabled,
    schedulerRunning,
    activeRuns,
    autoSpawnedAgents,
    debatePendingTasks,
    lastResult,
  }
}

function wakeOrchestratorTeam(reason: string) {
  const teamAgents = getTeamAgents()
  let woke = 0
  for (const agent of teamAgents) {
    if (agent.status === 'offline' || agent.status === 'error') {
      db_helpers.updateAgentStatus(agent.name, 'idle', reason)
      woke += 1
    }
  }
  return woke
}

export async function applyOrchestratorAction(
  action: OrchestratorAction,
  actor: string
): Promise<OrchestratorControlActionResponse> {
  const writeBase: SettingWrite[] = []
  const runDispatch = action === 'wake' || action === 'start' || action === 'restart'

  if (action === 'pause' || action === 'stop') {
    writeBase.push(
      { key: DISPATCH_KEY, value: 'false', description: 'Enable orchestrator auto-dispatch' },
      { key: SCHEDULED_RUNS_KEY, value: 'false', description: 'Enable scheduled orchestrator runs' },
      { key: FALLBACK_KEY, value: 'false', description: 'Enable Groq fallback dispatch' },
      { key: AUTONOMOUS_LOOP_KEY, value: 'false', description: 'Enable autonomous development loop' },
      { key: CONTROL_STATE_KEY, value: action === 'pause' ? 'paused' : 'stopped', description: 'Mission Control orchestrator state' },
    )
  } else {
    writeBase.push(
      { key: DISPATCH_KEY, value: 'true', description: 'Enable orchestrator auto-dispatch' },
      { key: SCHEDULED_RUNS_KEY, value: 'true', description: 'Enable scheduled orchestrator runs' },
      { key: FALLBACK_KEY, value: 'true', description: 'Enable Groq fallback dispatch' },
      { key: AUTONOMOUS_LOOP_KEY, value: 'true', description: 'Enable autonomous development loop' },
      { key: CONTROL_STATE_KEY, value: 'running', description: 'Mission Control orchestrator state' },
    )
  }

  writeSettings(writeBase, actor)

  let wokeAgents = 0
  if (action === 'wake' || action === 'restart') {
    wokeAgents = wakeOrchestratorTeam(
      action === 'wake'
        ? 'Mission Control wake command'
        : 'Mission Control restart command'
    )
  }

  let dispatchMessage = ''
  if (runDispatch) {
    const result = await triggerTask(parseBool(readSetting(AUTONOMOUS_LOOP_KEY), true) ? 'autonomous_dev_loop' : 'orchestrator_dispatch')
    dispatchMessage = result.message
  }

  const orchestrator = getOrchestratorControlState()
  const messageParts = []

  if (action === 'wake') {
    messageParts.push(wokeAgents > 0 ? `Woke ${wokeAgents} orchestrator agent${wokeAgents === 1 ? '' : 's'}` : 'Orchestrator already awake')
  } else if (action === 'start') {
    messageParts.push('Enabled orchestrator scheduling')
  } else if (action === 'pause') {
    messageParts.push('Paused new orchestrator dispatch')
  } else if (action === 'stop') {
    messageParts.push('Stopped new orchestrator dispatch')
  } else if (action === 'restart') {
    messageParts.push(wokeAgents > 0 ? `Restarted ${wokeAgents} orchestrator agent${wokeAgents === 1 ? '' : 's'}` : 'Restarted orchestrator control state')
  }

  if (dispatchMessage) {
    messageParts.push(dispatchMessage)
  }

  const message = messageParts.join(' | ')

  const teamAnchor = getTeamAgents()[0]
  db_helpers.logActivity(
    'orchestrator_control',
    'agent',
    teamAnchor?.id || 0,
    actor,
    message,
    { action, state: orchestrator.state }
  )

  logAuditEvent({
    action: `orchestrator_${action}`,
    actor,
    detail: {
      orchestrator,
      woke_agents: wokeAgents,
      dispatch_message: dispatchMessage || null,
    },
  })

  return {
    ok: true,
    action,
    message,
    orchestrator,
  }
}

export function updateOrchestratorFeatureToggles(
  toggles: OrchestratorFeatureToggles,
  actor: string
) {
  const settings: SettingWrite[] = []
  if (typeof toggles.autonomousLoopEnabled === 'boolean') {
    settings.push({ key: AUTONOMOUS_LOOP_KEY, value: String(toggles.autonomousLoopEnabled), description: 'Enable autonomous development loop' })
  }
  if (typeof toggles.autoSpawnEnabled === 'boolean') {
    settings.push({ key: AUTO_SPAWN_KEY, value: String(toggles.autoSpawnEnabled), description: 'Enable autonomous agent auto-spawn' })
  }
  if (typeof toggles.debateEnabled === 'boolean') {
    settings.push({ key: DEBATE_KEY, value: String(toggles.debateEnabled), description: 'Enable compact agent debate retries' })
  }
  if (typeof toggles.selfHealEnabled === 'boolean') {
    settings.push({ key: SELF_HEAL_KEY, value: String(toggles.selfHealEnabled), description: 'Enable safe repository self-heal actions' })
  }

  if (settings.length === 0) {
    return {
      ok: false,
      message: 'No autonomous feature changes provided',
      orchestrator: getOrchestratorControlState(),
    }
  }

  writeSettings(settings, actor)
  const orchestrator = getOrchestratorControlState()
  const message = [
    typeof toggles.autonomousLoopEnabled === 'boolean' ? `autonomous loop ${toggles.autonomousLoopEnabled ? 'on' : 'off'}` : null,
    typeof toggles.autoSpawnEnabled === 'boolean' ? `auto-spawn ${toggles.autoSpawnEnabled ? 'on' : 'off'}` : null,
    typeof toggles.debateEnabled === 'boolean' ? `debate ${toggles.debateEnabled ? 'on' : 'off'}` : null,
    typeof toggles.selfHealEnabled === 'boolean' ? `self-heal ${toggles.selfHealEnabled ? 'on' : 'off'}` : null,
  ].filter(Boolean).join(' | ')

  logAuditEvent({
    action: 'orchestrator_feature_toggle',
    actor,
    detail: { toggles, orchestrator },
  })

  return {
    ok: true,
    message,
    orchestrator,
  }
}
