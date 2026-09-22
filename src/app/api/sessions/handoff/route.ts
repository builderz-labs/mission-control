import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { heavyLimiter } from '@/lib/rate-limit'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { continueEffort, continueModelId } from '@/lib/session-continue-model'
import { fleetAgentFromHandoff, sameHandoffSeat } from '@/lib/adaptive-context-agent'
import { handoffEnv, pinAdaptiveContext, type AdaptiveHandoffPin } from '@/lib/adaptive-context-handoff'
import { buildHandoffBrief } from '@/lib/handoff-brief'
import { gitSnapshot } from '@/lib/handoff-git'
import { readKindTranscript } from '@/lib/session-transcript-read'
import type { FleetAgentName } from '@/lib/fleet-agents'
import {
  asTrimmedString,
  buildHandoffCommand,
  errorMessage,
  handoffBinName,
  handoffReply,
  isHandoffKind,
  isSessionId,
  parseSpawnedSessionId,
  resolveExecutable,
  resolveSessionCwd,
  runHandoffWithRetry,
  type HandoffCommand,
  type HandoffKind,
} from '@/lib/session-handoff'

export const dynamic = 'force-dynamic'

interface HandoffRequest {
  sourceKind: HandoffKind
  targetKind: HandoffKind
  sourceId: string
  title: string
  excerpt: string
  project: string
  sourceAgent: FleetAgentName
  targetAgent: FleetAgentName
  note?: string
  modelId?: string
  effort?: string
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const denied = denyUnscopedResourceForStrictWorkspace(auth.user, 'local_sessions', new URL(request.url).pathname)
  if (denied) return denied
  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = parseBody(body)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    return NextResponse.json(await executeHandoff(parsed))
  } catch (error: unknown) {
    logger.error({ err: error }, 'POST /api/sessions/handoff error')
    return NextResponse.json({ error: errorMessage(error, 'Failed to handoff session') }, { status: 500 })
  }
}

function parseBody(body: Record<string, unknown>): HandoffRequest | { error: string } {
  const sourceKind = asTrimmedString(body.sourceKind)
  const targetKind = asTrimmedString(body.targetKind)
  const sourceId = asTrimmedString(body.sourceId)
  const excerpt = asTrimmedString(body.excerpt)
  if (!isHandoffKind(sourceKind) || !isHandoffKind(targetKind)) return { error: 'Invalid kind' }
  if (!isSessionId(sourceId)) return { error: 'Invalid session id' }
  if (excerpt.length > 8000) return { error: 'excerpt is too long (max 8000 chars)' }
  return parsedHandoff(body, sourceKind, targetKind, sourceId, excerpt)
}

function parsedHandoff(
  body: Record<string, unknown>, sourceKind: HandoffKind, targetKind: HandoffKind, sourceId: string, excerpt: string,
): HandoffRequest | { error: string } {
  const project = asTrimmedString(body.project)
  const title = asTrimmedString(body.title) || 'Untitled'
  return {
    sourceKind, targetKind, sourceId, title, excerpt, project,
    sourceAgent: fleetAgentFromHandoff(sourceKind, asTrimmedString(body.sourceAgent)),
    targetAgent: fleetAgentFromHandoff(targetKind, asTrimmedString(body.targetAgent)),
    note: asTrimmedString(body.note) || undefined,
    modelId: continueModelId(targetKind, asTrimmedString(body.targetModel), body.fast === true),
    effort: continueEffort(targetKind, asTrimmedString(body.effort)),
  }
}

async function executeHandoff(input: HandoffRequest) {
  const resume = sameHandoffSeat(input.sourceKind, input.targetKind, input.sourceAgent, input.targetAgent)
  const messages = readKindTranscript(input.sourceKind, input.sourceId, 80)
  const cwd = await resolveSessionCwd(input.sourceId, input.project)
  const pin = await pinAdaptiveContext({
    from: input.sourceAgent, to: input.targetAgent, cwd, title: input.title, excerpt: input.excerpt,
  })
  const prompt = buildHandoffBrief({
    title: input.title,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    project: input.project,
    messages,
    excerpt: input.excerpt,
    note: input.note,
    git: gitSnapshot(cwd),
    sourceAgent: pin.from,
    targetAgent: pin.to,
    window: pin.window,
  })
  const spec = await makeSpec(input, resume, prompt, cwd, pin)
  try {
    const result = await runHandoffWithRetry(spec)
    const combined = `${result.stdout}\n${result.stderr}`
    return {
      ok: true as const,
      mode: (resume ? 'resume' : 'spawn') as 'resume' | 'spawn',
      kind: input.targetKind,
      id: resume ? input.sourceId : parseSpawnedSessionId(combined) || `pending:${input.targetKind}`,
      reply: await readReply(spec, result),
      window: pin.window,
      fromAgent: pin.from,
      toAgent: pin.to,
      compactRequired: pin.compactRequired,
    }
  } finally {
    await unlinkQuiet(spec.outputPath)
  }
}

async function makeSpec(input: HandoffRequest, resume: boolean, prompt: string, cwd: string, pin: AdaptiveHandoffPin) {
  return buildHandoffCommand({
    kind: input.targetKind,
    resumeId: resume ? input.sourceId : null,
    prompt,
    modelId: input.modelId,
    effort: input.effort,
    cwd,
    bin: await resolveExecutable(handoffBinName(input.targetKind)),
    extraArgs: pin.argv,
    env: handoffEnv(process.env, pin),
    outputPath: input.targetKind === 'codex-cli'
      ? path.join('/tmp', `mc-codex-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
      : undefined,
  })
}

async function readReply(spec: HandoffCommand, result: { stdout: string; stderr: string }): Promise<string> {
  if (spec.outputPath) {
    try {
      const text = (await fs.readFile(spec.outputPath, 'utf8')).trim()
      if (text) return text
    } catch { /* stdout fallback */ }
  }
  return handoffReply(result.stdout, result.stderr)
}

async function unlinkQuiet(filePath?: string) {
  if (!filePath) return
  try { await fs.unlink(filePath) } catch { /* ignore */ }
}
