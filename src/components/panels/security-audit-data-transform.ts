// Pure data-normalization functions that map the raw API response shapes
// to the internal SecurityAuditData structure. Kept separate so they can
// be unit-tested without rendering a component.

import type { SecurityAuditData } from './security-audit-panel-types'

const FLAGGED_THRESHOLD = 0.8

function normalizeAuthEvents(raw: unknown): SecurityAuditData['authEvents'] {
  if (Array.isArray(raw)) return raw as SecurityAuditData['authEvents']
  const obj = raw as Record<string, unknown>
  const events = (obj.recentEvents as unknown[]) ?? []
  return events.map((e: unknown, i: number) => {
    const ev = e as Record<string, unknown>
    return {
      id: i,
      type: String(ev.event_type ?? '').replace('auth.', ''),
      actor: String(ev.agent_name ?? 'unknown'),
      ip: String(ev.ip_address ?? ''),
      timestamp: Number(ev.created_at ?? 0),
      detail: String(ev.detail ?? ''),
    }
  })
}

function normalizeAgentTrust(raw: unknown): SecurityAuditData['agentTrust'] {
  if (Array.isArray(raw)) return raw as SecurityAuditData['agentTrust']
  const obj = raw as Record<string, unknown>
  const agents = (obj.agents as unknown[]) ?? []
  return agents.map((a: unknown, i: number) => {
    const agent = a as Record<string, unknown>
    const score = Number(agent.score ?? 0)
    return {
      agentId: i,
      name: String(agent.name ?? ''),
      trustScore: score,
      flagged: score < FLAGGED_THRESHOLD,
      lastEval: 0,
    }
  })
}

function normalizeSecretAlerts(raw: unknown, existing: unknown): SecurityAuditData['secretAlerts'] {
  if (Array.isArray(existing)) return existing as SecurityAuditData['secretAlerts']
  if (!raw) return []
  const obj = raw as Record<string, unknown>
  const recent = (obj.recent as unknown[]) ?? []
  return recent.map((e: unknown, i: number) => {
    const ev = e as Record<string, unknown>
    return {
      id: i,
      file: String(ev.detail ?? ''),
      line: 0,
      type: String(ev.event_type ?? '').replace('secret.', ''),
      preview: String(ev.detail ?? ''),
      detectedAt: Number(ev.created_at ?? 0),
      resolved: false,
    }
  })
}

function normalizeToolAudit(raw: unknown): SecurityAuditData['toolAudit'] {
  if (Array.isArray(raw)) return raw as SecurityAuditData['toolAudit']
  const obj = raw as Record<string, unknown>
  const topTools = (obj.topTools as unknown[]) ?? []
  return topTools.map((t: unknown) => {
    const tool = t as Record<string, unknown>
    const count = Number(tool.count ?? 0)
    return {
      tool: String(tool.name ?? ''),
      calls: count,
      successes: count,
      failures: 0,
    }
  })
}

function normalizeRateLimits(raw: unknown): SecurityAuditData['rateLimits'] {
  if (Array.isArray(raw)) return raw as SecurityAuditData['rateLimits']
  const obj = raw as Record<string, unknown>
  const byIp = (obj.byIp as unknown[]) ?? []
  return byIp.map((r: unknown) => {
    const rl = r as Record<string, unknown>
    return {
      ip: String(rl.ip ?? ''),
      hits: Number(rl.count ?? 0),
      lastHit: 0,
    }
  })
}

function normalizeInjectionAttempts(raw: unknown): SecurityAuditData['injectionAttempts'] {
  if (Array.isArray(raw)) return raw as SecurityAuditData['injectionAttempts']
  const obj = raw as Record<string, unknown>
  const recent = (obj.recent as unknown[]) ?? []
  return recent.map((e: unknown, i: number) => {
    const ev = e as Record<string, unknown>
    return {
      id: i,
      type: String(ev.event_type ?? '').replace('injection.', ''),
      source: String(ev.agent_name ?? ev.ip_address ?? 'unknown'),
      input: String(ev.detail ?? ''),
      blocked: true,
      timestamp: Number(ev.created_at ?? 0),
    }
  })
}

function normalizeTimeline(raw: unknown[]): SecurityAuditData['timeline'] {
  return raw.map((t: unknown) => {
    const pt = t as Record<string, unknown>
    return {
      timestamp: String(pt.timestamp ?? ''),
      authEvents: Number(pt.eventCount ?? 0),
      injectionAttempts: 0,
      secretAlerts: 0,
      toolCalls: 0,
    }
  })
}

/**
 * Normalizes the raw /api/security-audit JSON into the panel's internal
 * SecurityAuditData shape. Returns a new object — never mutates the input.
 */
export function normalizeAuditResponse(raw: Record<string, unknown>): SecurityAuditData {
  const toolAudit = raw.toolAudit
    ? normalizeToolAudit(raw.toolAudit)
    : normalizeToolAudit(raw.mcpAudit ?? [])

  const secretAlerts = normalizeSecretAlerts(raw.secretExposures, raw.secretAlerts)
  const timeline = Array.isArray(raw.timeline)
    ? normalizeTimeline(raw.timeline)
    : []

  return {
    posture: raw.posture as SecurityAuditData['posture'],
    scan: raw.scan as SecurityAuditData['scan'],
    authEvents: normalizeAuthEvents(raw.authEvents ?? []),
    agentTrust: normalizeAgentTrust(raw.agentTrust ?? []),
    secretAlerts,
    toolAudit,
    rateLimits: normalizeRateLimits(raw.rateLimits ?? []),
    injectionAttempts: normalizeInjectionAttempts(raw.injectionAttempts ?? []),
    timeline,
  }
}
