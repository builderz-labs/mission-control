/**
 * GET /api/epl/team
 *
 * "Agents + humans building together" — the humans half of the shared brain.
 * Reads public.people + agent_human_pairings + open handoffs from the Supabase
 * brain (project blcbvrxssmyqtxemmzzl) via PostgREST, server-side only.
 *
 * Env (first match wins, so the VPS /opt/shared/.env that Atlas already
 * sources works with zero extra config):
 *   EPL_BRAIN_URL  | SUPABASE_URL   (optional, defaults to the brain project URL)
 *   EPL_BRAIN_KEY  | SUPABASE_SERVICE_ROLE_KEY  (REQUIRED — service_role key;
 *                   server-side only, bypasses RLS. Never expose to the
 *                   browser / never commit.)
 *
 * Falls back to a clear "unconfigured" payload when no key is present,
 * matching the graceful-degradation pattern of the other epl routes.
 */

import { NextRequest, NextResponse } from 'next/server'

const BRAIN_URL =
  process.env.EPL_BRAIN_URL || process.env.SUPABASE_URL || 'https://blcbvrxssmyqtxemmzzl.supabase.co'
const BRAIN_KEY = process.env.EPL_BRAIN_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

async function brain(path: string): Promise<any[] | null> {
  if (!BRAIN_KEY) return null
  try {
    const r = await fetch(`${BRAIN_URL}/rest/v1/${path}`, {
      headers: { apikey: BRAIN_KEY, Authorization: `Bearer ${BRAIN_KEY}` },
      cache: 'no-store',
    })
    if (!r.ok) return null
    return (await r.json()) as any[]
  } catch {
    return null
  }
}

function summarise(people: any[], pairings: any[], handoffs: any[]) {
  return {
    people: people.length,
    active: people.filter(p => p.status === 'active').length,
    agents_paired: new Set(pairings.map(x => x.agent)).size,
    open_handoffs: handoffs.length,
  }
}

export async function GET(req: NextRequest) {
  const part = new URL(req.url).searchParams.get('part')

  const [people, pairings, handoffs] = await Promise.all([
    brain('people?select=*&order=status.asc,name.asc'),
    brain('agent_human_pairings?select=*'),
    brain('handoffs?status=eq.open&select=*&order=created_at.desc'),
  ])

  if (people === null) {
    const empty = { people: 0, active: 0, agents_paired: 0, open_handoffs: 0 }
    return NextResponse.json({
      source: 'unconfigured',
      note: 'Set EPL_BRAIN_KEY or SUPABASE_SERVICE_ROLE_KEY (service_role) to read public.people / agent_human_pairings / handoffs.',
      summary: empty,
      people: [],
      handoffs: [],
    })
  }

  const pr = pairings ?? []
  const ho = handoffs ?? []

  const byPerson: Record<string, { agent: string; pair_role: string | null }[]> = {}
  for (const p of pr) (byPerson[p.person_id] ??= []).push({ agent: p.agent, pair_role: p.pair_role })

  const enriched = people.map(pp => ({ ...pp, paired_agents: byPerson[pp.id] ?? [] }))
  const summary = summarise(people, pr, ho)

  if (part === 'summary') {
    return NextResponse.json({ ok: true, source: 'brain', summary })
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    source: 'brain',
    summary,
    people: enriched,
    handoffs: ho,
  })
}
