import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { logger } from '@/lib/logger'

interface GatewayModelEntry {
  id?: string
  name?: string
  provider?: string
  contextWindow?: number
  reasoning?: boolean
  input?: string[]
}

interface GatewayModelsListResult {
  models?: GatewayModelEntry[]
}

function toCanonicalModelValue(provider: string, id: string): string {
  const cleanId = String(id || '').trim()
  const cleanProvider = String(provider || '').trim()
  if (!cleanId) return ''
  if (cleanId.includes('/')) return cleanId
  return cleanProvider ? `${cleanProvider}/${cleanId}` : cleanId
}

function formatContextWindow(value?: number): string | null {
  if (!Number.isFinite(value) || !value || value <= 0) return null
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M ctx`
  }
  if (value >= 1_000) return `${Math.round(value / 1000)}k ctx`
  return `${value} ctx`
}

function buildModelLabel(entry: GatewayModelEntry, canonicalValue: string): string {
  const provider = String(entry.provider || '').trim()
  const baseName = String(entry.name || entry.id || canonicalValue).trim() || canonicalValue
  const meta = [provider].filter(Boolean)
  const contextText = formatContextWindow(entry.contextWindow)
  if (contextText) meta.push(contextText)
  if (entry.reasoning) meta.push('reasoning')
  if (Array.isArray(entry.input) && entry.input.includes('image')) meta.push('image')
  return meta.length > 0 ? `${baseName} — ${meta.join(' • ')}` : baseName
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const payload = await callOpenClawGateway<GatewayModelsListResult>('models.list', {}, 20_000)
    const rawModels = Array.isArray(payload?.models) ? payload.models : []
    const seen = new Set<string>()

    const models = rawModels
      .map((entry) => {
        const id = String(entry?.id || '').trim()
        const provider = String(entry?.provider || '').trim()
        const value = toCanonicalModelValue(provider, id)
        if (!value || seen.has(value)) return null
        seen.add(value)

        return {
          value,
          provider,
          id,
          name: String(entry?.name || '').trim() || value,
          label: buildModelLabel(entry, value),
          contextWindow: Number.isFinite(entry?.contextWindow) ? Number(entry.contextWindow) : null,
          reasoning: Boolean(entry?.reasoning),
          input: Array.isArray(entry?.input) ? entry.input.map((item) => String(item)) : [],
        }
      })
      .filter(Boolean)

    return NextResponse.json({ models })
  } catch (error) {
    logger.warn({ err: error }, 'spawn/models: failed to load OpenClaw model catalog')
    return NextResponse.json({ models: [], error: 'Failed to load OpenClaw models' }, { status: 200 })
  }
}
