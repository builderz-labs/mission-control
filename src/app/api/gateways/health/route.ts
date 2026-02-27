import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getDatabase } from "@/lib/db"

interface GatewayEntry {
  id: number
  name: string
  host: string
  port: number
  token: string
  is_primary: number
  status: string
}

interface HealthResult {
  id: number
  name: string
  status: "online" | "offline" | "error"
  latency: number | null
  agents: string[]
  sessions_count: number
  error?: string
}

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    const hostname = url.hostname
    // Block link-local / cloud metadata endpoints
    if (hostname.startsWith('169.254.')) return true
    // Block well-known cloud metadata hostnames
    if (hostname === 'metadata.google.internal') return true
    return false
  } catch {
    return true // Block malformed URLs
  }
}

/**
 * POST /api/gateways/health - Server-side health probe for all gateways
 * Probes gateways from the server where loopback addresses are reachable.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, "viewer")
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const gateways = db.prepare("SELECT * FROM gateways ORDER BY is_primary DESC, name ASC").all() as GatewayEntry[]

  // Prepare update statements once (avoids N+1)
  const updateOnlineStmt = db.prepare(
    "UPDATE gateways SET status = ?, latency = ?, last_seen = (unixepoch()), updated_at = (unixepoch()) WHERE id = ?"
  )
  const updateOfflineStmt = db.prepare(
    "UPDATE gateways SET status = ?, latency = NULL, updated_at = (unixepoch()) WHERE id = ?"
  )

  const results: HealthResult[] = []

  for (const gw of gateways) {
    const probeUrl = "http://" + gw.host + ":" + gw.port + "/"

    if (isBlockedUrl(probeUrl)) {
      results.push({ id: gw.id, name: gw.name, status: 'error', latency: null, agents: [], sessions_count: 0, error: 'Blocked URL' })
      continue
    }

    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const res = await fetch(probeUrl, {
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const latency = Date.now() - start
      const status = res.ok ? "online" : "error"

      updateOnlineStmt.run(status, latency, gw.id)

      results.push({
        id: gw.id,
        name: gw.name,
        status: status as "online" | "error",
        latency,
        agents: [],
        sessions_count: 0,
      })
    } catch (err: any) {
      updateOfflineStmt.run("offline", gw.id)

      results.push({
        id: gw.id,
        name: gw.name,
        status: "offline" as const,
        latency: null,
        agents: [],
        sessions_count: 0,
        error: err.name === "AbortError" ? "timeout" : (err.message || "connection failed"),
      })
    }
  }

  return NextResponse.json({ results, probed_at: Date.now() })
}
