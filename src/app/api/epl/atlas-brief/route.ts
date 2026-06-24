/**
 * GET /api/epl/atlas-brief
 *
 * Aggregator that composes Gerda's morning brief from every other /api/epl/*.
 * Becomes the data source for Atlas's 08:00 BST DM + the Today panel banner.
 *
 * Query params:
 *   ?format=markdown  → returns plain text Markdown (for direct Slack posting)
 *   ?format=json      → returns structured JSON (default)
 *   ?role=gerda       → personal brief (default)
 *   ?role=kris        → Kris's maintenance-heavy brief (Hugo-focused)
 *   ?role=arianne     → Arianne's pricing brief (post-Hanna)
 *
 * Cache: none. Hits the upstream /api/epl/* freshly each time (which themselves
 * have ~1.5s timeouts on agent /api/stats calls). Pulse to inspect should
 * complete in <5s even with all agents offline.
 *
 * This endpoint stays in MC; Atlas calls it on its cron and posts to Slack.
 * Removes the need for Atlas to duplicate the aggregation logic.
 */

import { NextRequest, NextResponse } from 'next/server'

type Role = 'gerda' | 'kris' | 'arianne'

interface BriefBundle {
  generatedAt: string
  role: Role
  today: any
  maintenance: any
  decisions_age_risk: any
  stale_roadmaps: any
}

function internalBase(req: NextRequest): string {
  // Override (preferred on the VPS so we skip TLS round-trip):
  //   MC_INTERNAL_URL=http://127.0.0.1:4000
  // Otherwise fall back to PORT-based localhost (works in dev), then to
  // the inbound request origin (works when the container can hit its own
  // public URL — not the case on Hetzner because Node fetch can't verify
  // the LE cert chain inside the slim runtime image).
  if (process.env.MC_INTERNAL_URL) return process.env.MC_INTERNAL_URL.replace(/\/$/, '')
  const port = process.env.PORT || '3000'
  return `http://127.0.0.1:${port}`
}

async function fetchPart(req: NextRequest, path: string): Promise<any> {
  const base = internalBase(req)
  // Forward inbound auth so MC middleware lets the internal call through.
  const headers: Record<string, string> = {}
  const apiKey = req.headers.get('x-api-key')
  if (apiKey) headers['x-api-key'] = apiKey
  const cookie = req.headers.get('cookie')
  if (cookie) headers['cookie'] = cookie
  try {
    const res = await fetch(`${base}${path}`, { cache: 'no-store', headers })
    if (!res.ok) return { error: `HTTP ${res.status}`, path, base }
    return await res.json()
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'fetch-failed', path, base }
  }
}

function renderMarkdown(b: BriefBundle): string {
  const lines: string[] = []
  const role = b.role
  const greeting = role === 'gerda'
    ? `*Good morning Gerda* — ${new Date(b.generatedAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`
    : role === 'kris'
      ? `*Morning Kris* — maintenance brief`
      : `*Morning Arianne* — pricing brief`
  lines.push(greeting)
  lines.push('')

  // Top 3 Actions (gerda role only — Kris/Arianne get role-specific)
  if (role === 'gerda' && b.today?.actions?.length) {
    lines.push('*🎯 Top 3 actions*')
    b.today.actions.slice(0, 3).forEach((a: any, i: number) => {
      lines.push(`${i + 1}. *${a.title}* — ${a.why}`)
    })
    lines.push('')
  }

  // Maintenance KPIs (everyone gets this — Hugo is the canary)
  if (b.maintenance) {
    const hugoStatus = b.maintenance.hugo_status === 'live' ? '🟢 live' : '🔴 offline'
    lines.push(`*🔧 Maintenance* — Hugo ${hugoStatus}`)
    lines.push(`• Open: ${b.maintenance.open_total ?? 0} (P0: ${b.maintenance.open_p0 ?? 0}, P1: ${b.maintenance.open_p1 ?? 0})`)
    lines.push(`• Awaiting parts >7d: ${b.maintenance.awaiting_parts_aged_gt7d ?? 0}`)
    if (b.maintenance.resolved_this_week !== undefined) {
      lines.push(`• Resolved this week: ${b.maintenance.resolved_this_week}`)
    }
    lines.push('')
  }

  // KPIs for Gerda
  if (role === 'gerda' && b.today?.kpis?.length) {
    lines.push('*📊 KPIs*')
    b.today.kpis.forEach((k: any) => {
      lines.push(`• ${k.label}: *${k.value}* ${k.delta ? `_${k.delta}_` : ''}`)
    })
    lines.push('')
  }

  // Age-risk decisions
  if (b.decisions_age_risk?.aged_count > 0) {
    lines.push(`*⚠️ Decisions stuck >10 days:* ${b.decisions_age_risk.aged_count}`)
    b.decisions_age_risk.items?.slice(0, 5).forEach((d: any) => {
      lines.push(`• [${d.id}] ${d.title} — *${d.age_days}d* (owner: ${d.owner})`)
    })
    lines.push('')
  }

  // Stale ROADMAPs (Friday only, but expose always for the agents panel)
  const today = new Date(b.generatedAt).getUTCDay()
  if ((today === 5 || role === 'gerda') && b.stale_roadmaps?.items?.length) {
    lines.push(`*🗺 Stale ROADMAPs (>7d):* ${b.stale_roadmaps.items.length}`)
    b.stale_roadmaps.items.slice(0, 5).forEach((a: any) => {
      lines.push(`• ${a.name} (${a.role}) — ${a.roadmap_age_days}d`)
    })
    lines.push('')
  }

  // Waiting on you (gerda only)
  if (role === 'gerda' && b.today?.waitingOnYou?.length) {
    lines.push(`*⏳ Waiting on you:* ${b.today.waitingOnYou.length}`)
    b.today.waitingOnYou.slice(0, 5).forEach((w: any) => {
      lines.push(`• [${w.id}] ${w.title} — ${w.age} (${w.category})`)
    })
    lines.push('')
  }

  lines.push('— atlas')
  return lines.join('\n')
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase()
  const role = ((url.searchParams.get('role') ?? 'gerda').toLowerCase() as Role)

  const [today, maintenance, decisions_age_risk, stale_roadmaps] = await Promise.all([
    fetchPart(req, '/api/epl/today'),
    fetchPart(req, '/api/epl/maintenance?part=summary'),
    fetchPart(req, '/api/epl/decisions?part=age-risk'),
    fetchPart(req, '/api/epl/agents?part=stale-roadmaps'),
  ])

  const bundle: BriefBundle = {
    generatedAt: new Date().toISOString(),
    role,
    today,
    maintenance,
    decisions_age_risk,
    stale_roadmaps,
  }

  if (format === 'markdown' || format === 'md' || format === 'slack') {
    return new NextResponse(renderMarkdown(bundle), {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  return NextResponse.json({ ...bundle, markdown: renderMarkdown(bundle) })
}
