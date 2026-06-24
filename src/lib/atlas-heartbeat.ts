/**
 * Atlas heartbeat reader.
 *
 * Atlas writes /opt/atlas/data/last_heartbeat.json every 5 minutes with the
 * live state of the agent fleet. Mounted into the MC container read-only at
 * /atlas-data (see docker-compose.yml). This module is the single reader.
 *
 * Returns null if the mount isn't present or the file isn't parseable — the
 * EPL panels then fall back to the canned snapshot. Never throws.
 *
 * No caching needed: file rewrites every ~5 min, fs read is sub-ms.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface AtlasHeartbeatAgent {
  name: string
  status: 'live' | 'review' | 'offline' | 'blocked' | string
  last_action: string | null
  last_action_at: string | null  // ISO-ish "YYYY-MM-DD HH:MM:SS"
  cost_today_usd: number
  tasks_today: number
  drift: boolean
  session_last_age_hours: number | null
  notes: string[]
}

export interface AtlasHeartbeat {
  schema_version: string
  atlas_version: string
  timestamp: string
  host: string
  spend_today_usd: number
  sub_sessions_today: number
  pending_approvals: number
  agents: AtlasHeartbeatAgent[]
}

const HEARTBEAT_PATH = process.env.ATLAS_HEARTBEAT_PATH
  ?? '/atlas-data/last_heartbeat.json'

export async function readHeartbeat(): Promise<AtlasHeartbeat | null> {
  try {
    const raw = await fs.readFile(HEARTBEAT_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.agents)) {
      return null
    }
    return parsed as AtlasHeartbeat
  } catch {
    return null
  }
}

export function heartbeatAgentMap(hb: AtlasHeartbeat | null): Map<string, AtlasHeartbeatAgent> {
  const m = new Map<string, AtlasHeartbeatAgent>()
  if (!hb) return m
  for (const a of hb.agents) {
    if (a && typeof a.name === 'string') m.set(a.name.toLowerCase(), a)
  }
  return m
}

export function heartbeatPath(): string {
  return path.resolve(HEARTBEAT_PATH)
}
