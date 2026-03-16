import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  getPersona,
  getPADState,
  getActiveBiases,
  mergePersonaFragment,
  updatePADState,
  applyPreset,
  getPresetNames,
  getAgentTrustNetwork,
} from '@/lib/persona-engine'
import type { BigFive, PersonaConfig } from '@/lib/persona-engine'

/**
 * GET /api/agents/[id]/persona — returns persona config, PAD state, active biases, trust network
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const agentId = Number(id)
    const workspaceId = auth.user.workspace_id ?? 1

    const agent = db.prepare(
      'SELECT id, name, config FROM agents WHERE id = ? AND workspace_id = ?'
    ).get(agentId, workspaceId) as { id: number; name: string; config: string | null } | undefined

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const config: Record<string, unknown> = agent.config ? JSON.parse(agent.config) : {}
    const persona = getPersona(config)
    const padState = getPADState(config)
    const bigFive = persona?.personality?.big_five
    const activeBiases = bigFive ? getActiveBiases(bigFive).map(b => ({ name: b.name, description: b.description })) : []
    const trustNetwork = getAgentTrustNetwork(db, agentId)
    const presets = getPresetNames()

    return NextResponse.json({
      persona: persona ?? {},
      padState,
      activeBiases,
      trustNetwork,
      presets,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/persona error')
    return NextResponse.json({ error: 'Failed to fetch persona' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id]/persona — update OCEAN traits, apply preset, update PAD state
 *
 * Body options:
 *   { bigFive: BigFive }           — update OCEAN traits
 *   { preset: string }             — apply preset (overwrites OCEAN)
 *   { padState: { pleasure?, arousal?, dominance? } } — update PAD
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const agentId = Number(id)
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    const db = getDatabase()
    const agent = db.prepare(
      'SELECT id FROM agents WHERE id = ? AND workspace_id = ?'
    ).get(agentId, workspaceId)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Apply preset
    if (body.preset && typeof body.preset === 'string') {
      const applied = applyPreset(agentId, body.preset, workspaceId)
      if (!applied) {
        return NextResponse.json({ error: `Unknown preset: ${body.preset}` }, { status: 400 })
      }
    }

    // Update Big Five traits
    if (body.bigFive) {
      const bf = body.bigFive as BigFive
      const fragment: Partial<PersonaConfig> = {
        personality: {
          traits: [],
          big_five: bf,
        },
      }
      mergePersonaFragment(agentId, fragment, workspaceId)
    }

    // Update PAD state
    if (body.padState) {
      updatePADState(agentId, body.padState, workspaceId)
    }

    // Return updated state
    const updatedAgent = db.prepare(
      'SELECT config FROM agents WHERE id = ? AND workspace_id = ?'
    ).get(agentId, workspaceId) as { config: string | null } | undefined

    const config: Record<string, unknown> = updatedAgent?.config ? JSON.parse(updatedAgent.config) : {}
    const persona = getPersona(config)
    const padState = getPADState(config)
    const bigFive = persona?.personality?.big_five
    const activeBiases = bigFive ? getActiveBiases(bigFive).map(b => ({ name: b.name, description: b.description })) : []

    return NextResponse.json({
      persona: persona ?? {},
      padState,
      activeBiases,
    })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents/[id]/persona error')
    return NextResponse.json({ error: 'Failed to update persona' }, { status: 500 })
  }
}
