import type { Agent } from '@/store'

export type OfficeZoneType = 'engineering' | 'operations' | 'research' | 'product' | 'quality' | 'general'

export interface OfficeZoneDefinition {
  id: OfficeZoneType
  label: string
  icon: string
  accentClass: string
  roleKeywords: string[]
}

export interface WorkstationAnchor {
  deskId: string
  seatLabel: string
  row: number
  col: number
  x: number
  y: number
}

export interface ZonedAgent {
  agent: Agent
  anchor: WorkstationAnchor
}

export interface OfficeZoneLayout {
  zone: OfficeZoneDefinition
  workers: ZonedAgent[]
}

const OFFICE_ZONES: OfficeZoneDefinition[] = [
  {
    id: 'engineering',
    label: 'Engineering Bay',
    icon: '🧑‍💻',
    accentClass: 'border-cyan-500/30 bg-cyan-500/10',
    roleKeywords: ['engineer', 'dev', 'frontend', 'backend', 'fullstack', 'software'],
  },
  {
    id: 'operations',
    label: 'Operations Pod',
    icon: '🛠️',
    accentClass: 'border-amber-500/30 bg-amber-500/10',
    roleKeywords: ['ops', 'sre', 'infra', 'platform', 'reliability'],
  },
  {
    id: 'research',
    label: 'Research Corner',
    icon: '🔬',
    accentClass: 'border-violet-500/30 bg-violet-500/10',
    roleKeywords: ['research', 'science', 'analyst', 'ai'],
  },
  {
    id: 'product',
    label: 'Product Studio',
    icon: '📐',
    accentClass: 'border-emerald-500/30 bg-emerald-500/10',
    roleKeywords: ['product', 'pm', 'design', 'ux', 'ui'],
  },
  {
    id: 'quality',
    label: 'Quality Lab',
    icon: '🧪',
    accentClass: 'border-rose-500/30 bg-rose-500/10',
    roleKeywords: ['qa', 'test', 'quality'],
  },
  {
    id: 'general',
    label: 'General Workspace',
    icon: '🏢',
    accentClass: 'border-slate-500/30 bg-slate-500/10',
    roleKeywords: [],
  },
]

function normalizeRole(role: string | undefined): string {
  return String(role || '').toLowerCase()
}

function getZoneByRole(role: string | undefined): OfficeZoneDefinition {
  const normalized = normalizeRole(role)
  for (const zone of OFFICE_ZONES) {
    if (zone.id === 'general') continue
    if (zone.roleKeywords.some((keyword) => normalized.includes(keyword))) {
      return zone
    }
  }
  return OFFICE_ZONES.find((zone) => zone.id === 'general')!
}

function buildAnchor(index: number, columnCount: number): WorkstationAnchor {
  const row = Math.floor(index / columnCount)
  const col = index % columnCount
  const rowLabel = String.fromCharCode(65 + row)
  const seatLabel = `${rowLabel}${col + 1}`
  return {
    deskId: `desk-${seatLabel.toLowerCase()}`,
    seatLabel,
    row,
    col,
    // Useful for future absolute-position movement/collision mechanics.
    x: col * 220 + 110,
    y: row * 160 + 80,
  }
}

export function buildOfficeLayout(agents: Agent[]): OfficeZoneLayout[] {
  const zoneMap = new Map<OfficeZoneType, Agent[]>()
  for (const zone of OFFICE_ZONES) zoneMap.set(zone.id, [])

  for (const agent of agents) {
    const zone = getZoneByRole(agent.role)
    zoneMap.get(zone.id)!.push(agent)
  }

  const result: OfficeZoneLayout[] = []
  for (const zone of OFFICE_ZONES) {
    const workers = zoneMap.get(zone.id) || []
    if (workers.length === 0) continue

    const columns = workers.length >= 8 ? 4 : workers.length >= 4 ? 3 : 2
    const zoned = workers.map((agent, i) => ({
      agent,
      anchor: buildAnchor(i, columns),
    }))

    result.push({ zone, workers: zoned })
  }

  return result.sort((a, b) => b.workers.length - a.workers.length)
}
