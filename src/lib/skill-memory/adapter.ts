import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export interface SkillMemoryHealth {
  installed: boolean
  version: string | null
  db_path: string
  database_exists: boolean
  schema_version: string | null
  total: number
  skills: number
  deleted: number
  history_rows: number
  lexical_reindex_pending: boolean
  semantic_status: string | null
  chain_ok: boolean | null
  detail: string | null
}

const ROOT = process.cwd()
const DEFAULT_EXE = resolve(ROOT, '.venv-skillmem', 'Scripts', 'skillmem.exe')
const DEFAULT_DB = resolve(ROOT, '.data', 'skillmem', 'skillmem.db')
const TIMEOUT_MS = 15_000
const MAX_BUFFER = 512_000

function executablePath() {
  return resolve(process.env.AI_OPS_SKILLMEM_BIN || DEFAULT_EXE)
}

function dbPath() {
  return resolve(process.env.AI_OPS_SKILLMEM_DB || DEFAULT_DB)
}

interface SkillMemoryProbe {
  exists: (path: string) => boolean
  exec: typeof spawnSync
}

const defaultProbe: SkillMemoryProbe = { exists: existsSync, exec: spawnSync }

function run(args: string[], probe: SkillMemoryProbe = defaultProbe) {
  const exe = executablePath()
  if (!probe.exists(exe)) {
    return { ok: false, stdout: '', stderr: 'skillmem executable not installed', status: null as number | null }
  }
  const result = probe.exec(exe, ['--db', dbPath(), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
    },
  })
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || ''),
    stderr: result.error?.message || String(result.stderr || ''),
    status: result.status,
  }
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.trim()) as T
  } catch {
    return null
  }
}

export function getSkillMemoryHealth(probe: SkillMemoryProbe = defaultProbe): SkillMemoryHealth {
  const exe = executablePath()
  const db = dbPath()
  if (!probe.exists(exe)) {
    return {
      installed: false,
      version: null,
      db_path: db,
      database_exists: probe.exists(db),
      schema_version: null,
      total: 0,
      skills: 0,
      deleted: 0,
      history_rows: 0,
      lexical_reindex_pending: false,
      semantic_status: null,
      chain_ok: null,
      detail: 'skillmem executable is not installed in the isolated AI Ops Hub venv.',
    }
  }

  const versionRun = probe.exec(exe, ['--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    shell: false,
    env: { ...process.env, PYTHONUTF8: '1' },
  })
  const versionText = String(versionRun.stdout || '').trim()
  const version = /version\s+([^\s]+)/i.exec(versionText)?.[1] || null

  const doctor = run(['doctor'], probe)
  const parsed = parseJson<{
    schema_version?: string
    total?: number
    skills?: number
    deleted?: number
    history_rows?: number
    lexical_reindex_pending?: boolean
    semantic?: { status?: string }
  }>(doctor.stdout)

  const verify = run(['verify'], probe)
  const verifyText = [verify.stdout, verify.stderr].join('\n')
  const chainOk = verify.ok
    ? /OK:\s*chain intact/i.test(verifyText) || /checked\s+0\s+history rows/i.test(verifyText)
    : false

  return {
    installed: true,
    version,
    db_path: db,
    database_exists: probe.exists(db),
    schema_version: parsed?.schema_version || null,
    total: Number(parsed?.total || 0),
    skills: Number(parsed?.skills || 0),
    deleted: Number(parsed?.deleted || 0),
    history_rows: Number(parsed?.history_rows || 0),
    lexical_reindex_pending: parsed?.lexical_reindex_pending === true,
    semantic_status: parsed?.semantic?.status || null,
    chain_ok: chainOk,
    detail: doctor.ok ? null : doctor.stderr || 'skillmem doctor failed',
  }
}

export function getSkillMemoryPolicy() {
  return {
    integration_mode: 'read_only',
    auto_trust: false,
    hooks_enabled_by_ai_ops: false,
    agent_mcp_wiring_enabled_by_ai_ops: false,
    semantic_embeddings_enabled: false,
    reinforcement_requires_external_evidence: true,
    paid_model_calls_required: false,
  }
}
