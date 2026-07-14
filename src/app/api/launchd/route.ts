import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/db'
import { runCommand } from '@/lib/command'
import { logger } from '@/lib/logger'

// Flota launchd de Helix (HLX-298): historial + learnings por cron, y kickstart
// con confirmación (F4/HLX-292). Fuente: launchctl + logs de LaunchAgents.

const LOG_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'memory', 'launchd')
const LEARNINGS_PATH = path.join(os.homedir(), '.openclaw', 'cron', 'launchd-learnings.json')
const LABEL_RE = /^(com\.helix\.|ai\.openclaw\.)[a-zA-Z0-9._-]+$/

interface FleetEntry {
  label: string
  pid: number | null
  lastExit: number | null
  outTail: string[]
  errTail: string[]
  learnings: string
}

async function readLearnings(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(LEARNINGS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

async function tailLog(file: string, lines: number): Promise<string[]> {
  try {
    const content = await readFile(file, 'utf-8')
    return content.split('\n').filter(Boolean).slice(-lines)
  } catch {
    return []
  }
}

// El log se llama como el label sin el prefijo com.helix.cron. / com.helix.
function logBasename(label: string): string {
  return label.replace(/^com\.helix\.cron\./, '').replace(/^com\.helix\./, '').replace(/^ai\.openclaw\./, '')
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const uid = process.getuid?.() ?? 501
    const list = await runCommand('launchctl', ['list'], { timeoutMs: 5000 })
    if (list.code !== 0) {
      return NextResponse.json({ error: 'launchctl no disponible', fleet: [] }, { status: 200 })
    }
    const learnings = await readLearnings()
    const rows = list.stdout
      .split('\n')
      .map(l => l.trim().split(/\s+/))
      .filter(cols => cols.length === 3 && LABEL_RE.test(cols[2]))

    const fleet: FleetEntry[] = await Promise.all(
      rows.map(async ([pid, exit, label]) => {
        const base = logBasename(label)
        return {
          label,
          pid: pid === '-' ? null : Number(pid),
          lastExit: exit === '-' ? null : Number(exit),
          outTail: await tailLog(path.join(LOG_DIR, `${base}.out.log`), 5),
          errTail: await tailLog(path.join(LOG_DIR, `${base}.err.log`), 5),
          learnings: learnings[label] ?? '',
        }
      })
    )
    fleet.sort((a, b) => a.label.localeCompare(b.label))
    return NextResponse.json({ fleet, uid, total: fleet.length })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/launchd error')
    return NextResponse.json({ error: err?.message || 'error', fleet: [] }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const action = body?.action as string
    const label = body?.label as string
    if (!label || !LABEL_RE.test(label)) {
      return NextResponse.json({ error: 'label inválido (solo flota com.helix.* / ai.openclaw.*)' }, { status: 400 })
    }

    if (action === 'kickstart') {
      const uid = process.getuid?.() ?? 501
      const res = await runCommand('launchctl', ['kickstart', `gui/${uid}/${label}`], { timeoutMs: 10000 })
      logAuditEvent({
        action: 'launchd_kickstart',
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'launchd',
        detail: { label, result: res.code === 0 ? 'ok' : `exit ${res.code}: ${res.stderr.slice(0, 200)}` },
      })
      if (res.code !== 0) {
        return NextResponse.json({ error: `kickstart falló (exit ${res.code})`, stderr: res.stderr }, { status: 500 })
      }
      return NextResponse.json({ ok: true, label })
    }

    if (action === 'learning') {
      const note = String(body?.note ?? '').slice(0, 4000)
      const learnings = await readLearnings()
      learnings[label] = note
      await mkdir(path.dirname(LEARNINGS_PATH), { recursive: true })
      await writeFile(LEARNINGS_PATH, JSON.stringify(learnings, null, 2), 'utf-8')
      logAuditEvent({
        action: 'launchd_learning_saved',
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'launchd',
        detail: { label, chars: note.length },
      })
      return NextResponse.json({ ok: true, label })
    }

    return NextResponse.json({ error: 'action inválida (kickstart | learning)' }, { status: 400 })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/launchd error')
    return NextResponse.json({ error: err?.message || 'error' }, { status: 500 })
  }
}
