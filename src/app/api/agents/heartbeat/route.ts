import { NextRequest, NextResponse } from "next/server"
import { getDatabase } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logger } from "@/lib/logger"

/**
 * POST /api/agents/heartbeat — Atlas fleet snapshot ingestion.
 *
 * Atlas POSTs every 5 min from `atlas-heartbeat.timer` per the contract at
 * ~/atlas/specs/mc_heartbeat_contract.md (schema v1). Each POST is a full
 * state replacement for the host. We persist into the agent_heartbeats
 * table; UI panels read from there.
 *
 * Auth: `x-api-key` or `Authorization: Bearer <key>` — both routed via
 * MC requireRole/extractApiKeyFromHeaders. Minimum role: agent.
 *
 * GET /api/agents/heartbeat — read latest snapshot(s).
 *   ?host=<hostname> returns one snapshot; omit for all hosts.
 */

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS agent_heartbeats (
    host TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    atlas_version TEXT,
    timestamp TEXT NOT NULL,
    spend_today_usd REAL NOT NULL DEFAULT 0,
    sub_sessions_today INTEGER NOT NULL DEFAULT 0,
    pending_approvals INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    received_at INTEGER NOT NULL
  )
`

function ensureTable() {
  const db = getDatabase()
  db.exec(TABLE_DDL)
  return db
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, "viewer")
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (body?.schema_version !== "1") {
    return NextResponse.json(
      { error: `Unsupported schema_version: ${body?.schema_version}` },
      { status: 400 }
    )
  }

  const host = typeof body?.host === "string" ? body.host.trim() : ""
  if (!host) {
    return NextResponse.json({ error: "host required" }, { status: 400 })
  }

  const timestamp = typeof body?.timestamp === "string" ? body.timestamp : new Date().toISOString()
  const atlasVersion = typeof body?.atlas_version === "string" ? body.atlas_version : null
  const spend = Number.isFinite(body?.spend_today_usd) ? Number(body.spend_today_usd) : 0
  const subSessions = Number.isInteger(body?.sub_sessions_today) ? Number(body.sub_sessions_today) : 0
  const pending = Number.isInteger(body?.pending_approvals) ? Number(body.pending_approvals) : 0
  const agentCount = Array.isArray(body?.agents) ? body.agents.length : 0

  try {
    const db = ensureTable()
    const now = Math.floor(Date.now() / 1000)

    db.prepare(`
      INSERT INTO agent_heartbeats
        (host, schema_version, atlas_version, timestamp, spend_today_usd,
         sub_sessions_today, pending_approvals, payload, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host) DO UPDATE SET
        schema_version = excluded.schema_version,
        atlas_version = excluded.atlas_version,
        timestamp = excluded.timestamp,
        spend_today_usd = excluded.spend_today_usd,
        sub_sessions_today = excluded.sub_sessions_today,
        pending_approvals = excluded.pending_approvals,
        payload = excluded.payload,
        received_at = excluded.received_at
    `).run(
      host,
      body.schema_version,
      atlasVersion,
      timestamp,
      spend,
      subSessions,
      pending,
      JSON.stringify(body),
      now,
    )

    logger.info(
      { host, agentCount, spendToday: spend, pending },
      "Heartbeat ingested"
    )

    return NextResponse.json({
      received: true,
      host,
      agents_received: agentCount,
      received_at: now,
    })
  } catch (err: any) {
    logger.error({ err: err?.message, host }, "Heartbeat write failed")
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, "viewer")
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const db = ensureTable()
    const url = new URL(request.url)
    const hostFilter = url.searchParams.get("host")

    if (hostFilter) {
      const row = db.prepare(
        "SELECT * FROM agent_heartbeats WHERE host = ?"
      ).get(hostFilter) as any
      if (!row) {
        return NextResponse.json(
          { error: "No heartbeat for that host" },
          { status: 404 }
        )
      }
      return NextResponse.json({ ...row, payload: JSON.parse(row.payload) })
    }

    const rows = db.prepare(
      "SELECT * FROM agent_heartbeats ORDER BY received_at DESC"
    ).all() as any[]

    return NextResponse.json({
      hosts: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
      count: rows.length,
    })
  } catch (err: any) {
    logger.error({ err: err?.message }, "Heartbeat read failed")
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
