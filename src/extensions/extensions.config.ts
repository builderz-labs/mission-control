/**
 * Extension manifest declarations — @stroupaloop/mission-control
 *
 * Each entry describes an AMS extension: which API routes it provides,
 * which startup hooks to run, and which recurring tasks to schedule.
 *
 * API routes are implemented as plain handler functions in
 * src/extensions/<area>/api/*.ts and re-exported from Next.js route shims.
 * This manifest is the authoritative registry — if an extension isn't listed
 * here, it won't have its hooks or scheduled tasks wired at boot.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

// Primitive descriptor types live in extensions.config.ts.types so they can
// be safely imported by manifest.client.ts (client graph) without dragging
// server-only code through the bundler.
export type { ApiRouteDescriptor, ScheduledTask, PanelDescriptor } from './extensions.config.ts.types'
import type { ApiRouteDescriptor, ScheduledTask, PanelDescriptor } from './extensions.config.ts.types'

export interface ExtensionManifest {
  id: 'resolver' | 'litellm' | 'oap' | 'mcp' | 'security-audit' | 'fleet'
  /** Human-readable extension name */
  displayName: string
  /** API routes provided by this extension */
  apiRoutes: ApiRouteDescriptor[]
  /** Hooks run once at application boot (before first request) */
  startupHooks?: Array<() => void | Promise<void>>
  /** Recurring tasks registered with the MC scheduler */
  scheduledTasks?: ScheduledTask[]
  /** UI panels provided by this extension (client-registered via client.ts) */
  panels?: PanelDescriptor[]
}

// ── Resolver Extension ────────────────────────────────────────────────────────

import { ingestResolverTelemetry, rebuildResolverDailyMetrics, ensureResolverTables } from './resolver/telemetry'
import { getDatabase } from '@/lib/db'
import { ensureCacheDailyTable, rollupCacheMetrics } from './litellm/cache-metrics'
import { ensureLitellmUsageTable } from './litellm/usage'

const RESOLVER_TICK_MS = 60 * 1000 // 60s — tail JSONL every minute
const RESOLVER_ROLLUP_MS = 5 * 60 * 1000 // 5min — rebuild daily metrics

const resolverExtension: ExtensionManifest = {
  id: 'resolver',
  displayName: 'Resolver Intelligence',
  apiRoutes: [
    { path: '/resolver/metrics', methods: ['GET'] },
    { path: '/resolver/recent', methods: ['GET'] },
    { path: '/resolver/recommendations', methods: ['GET'] },
    { path: '/resolver/overrides', methods: ['GET', 'POST'] },
    { path: '/resolver/overrides/:toolId', methods: ['DELETE'] },
  ],
  panels: [
    {
      id: 'resolver-intelligence',
      label: 'Resolver Intelligence',
      groupId: 'observe',
      icon: 'brain-circuit',
    },
  ],
  startupHooks: [
    () => {
      // Ensure resolver DB tables exist at boot time (idempotent migration)
      try {
        const db = getDatabase()
        ensureResolverTables(db)
      } catch {
        // Non-fatal — tables will be created on first ingest
      }
    },
  ],
  scheduledTasks: [
    {
      name: 'resolver_telemetry_ingest',
      intervalMs: RESOLVER_TICK_MS,
      fn: async () => {
        ingestResolverTelemetry()
      },
    },
    {
      name: 'resolver_metrics_rollup',
      intervalMs: RESOLVER_ROLLUP_MS,
      fn: async () => {
        rebuildResolverDailyMetrics()
      },
    },
  ],
}

// ── LiteLLM Extension ─────────────────────────────────────────────────────────

const litellmExtension: ExtensionManifest = {
  id: 'litellm',
  displayName: 'LiteLLM Usage & Attribution',
  apiRoutes: [
    { path: '/litellm/usage', methods: ['GET', 'POST'] },
    { path: '/litellm/usage/summary', methods: ['GET'] },
    { path: '/litellm/dashboard/records', methods: ['GET'] },
    { path: '/litellm/dashboard/summary', methods: ['GET'] },
    { path: '/litellm/cache', methods: ['GET'] },
  ],
  panels: [
    {
      id: 'litellm-usage',
      label: 'LiteLLM Usage',
      groupId: 'observe',
      icon: 'activity',
    },
  ],
  startupHooks: [
    () => {
      try {
        const db = getDatabase()
        ensureLitellmUsageTable(db)
        ensureCacheDailyTable(db)
      } catch (err) {
        // Non-fatal — but log so startup failures are visible in container logs
        console.error('[litellm] startup hook failed:', err)
      }
    },
  ],
  scheduledTasks: [
    {
      name: 'litellm_cache_rollup',
      intervalMs: 5 * 60 * 1000,
      fn: async () => {
        const db = getDatabase()
        const result = rollupCacheMetrics(db)
        // Log result for visibility in container logs
        console.info(`[litellm] cache rollup: ${result.rows_upserted} day/model rows upserted`)
      },
    },
  ],
}

// ── OAP Extension ──────────────────────────────────────────────────────────────

const oapExtension: ExtensionManifest = {
  id: 'oap',
  displayName: 'OAP Audit Ingest & Approvals',
  apiRoutes: [
    { path: '/audit', methods: ['GET', 'POST'] },
    { path: '/oap/approvals', methods: ['GET', 'POST', 'PATCH'] },
  ],
  panels: [
    {
      id: 'oap-approvals',
      label: 'OAP Approvals',
      groupId: 'observe',
      icon: 'shield-check',
    },
    {
      id: 'oap-audit',
      label: 'OAP Audit Trail',
      groupId: 'observe',
      icon: 'file-clock',
    },
  ],
}

// ── MCP Extension ──────────────────────────────────────────────────────────────

const mcpExtension: ExtensionManifest = {
  id: 'mcp',
  displayName: 'MCP Audit Pipeline',
  apiRoutes: [
    { path: '/mcp-audit/verify', methods: ['GET'] },
  ],
}

// ── Security-Audit Extension ───────────────────────────────────────────────────

const securityAuditExtension: ExtensionManifest = {
  id: 'security-audit',
  displayName: 'Security Audit',
  apiRoutes: [
    { path: '/security-audit', methods: ['GET', 'POST'] },
  ],
}

// ── Fleet Extension ────────────────────────────────────────────────────────────
//
// Phase-2.0 of the ender-stack vertical-slice rollout
// (stroupaloop/ender-stack#149). Read-only "Fleet" page that lists
// production-deployed agents (ECS services in this deployment's cluster),
// paving the way for Phase-2.2's Deploy button + 2.3's Create-agent flow.
// Calls AWS SDK ECS server-side using the MC task role's IAM grant
// (provisioned in ender-stack PR #150 — `ecs:ListServices` +
// `ecs:DescribeServices`, scoped to the ender-stack-{env} cluster).
//
// Distinct from upstream's /agents page (which serves the local/docker
// dev-iteration workflow). Two views, two layers — see Phase-2.X tracker
// for the future upstream `deploymentModeRegistry` hook that would unify
// them.

const fleetExtension: ExtensionManifest = {
  id: 'fleet',
  displayName: 'Fleet',
  apiRoutes: [
    { path: '/fleet/services', methods: ['GET'] },
    { path: '/fleet/services/:name/redeploy', methods: ['POST'] },
    { path: '/fleet/agents', methods: ['POST'] },
    { path: '/fleet/agents/:name', methods: ['DELETE'] },
    { path: '/fleet/agents/:name/slack/manifest', methods: ['GET'] },
    // Slack credential paste is intentionally REST-only (no MCP
    // tool). Token rotation is a manual operator step driven
    // from the agent-detail panel; agents shouldn't rotate their
    // own Slack tokens. Round-6 audit on PR #48 flagged the MCP
    // gap; this comment documents the deliberate omission.
    { path: '/fleet/agents/:name/slack/credentials', methods: ['POST'] },
    // Slack channels-list is intentionally REST-only (no MCP
    // tool). Operator-driven UI: opens when the picker renders,
    // shouldn't be invoked by an agent enumerating channel
    // metadata. Round-1 audit on PR #49 flagged the missing
    // documentation; mirrors the credentials-POST exclusion
    // above for the same architectural reason.
    { path: '/fleet/agents/:name/slack/channels', methods: ['GET'] },
    { path: '/fleet/harness-defaults', methods: ['GET'] },
  ],
  panels: [
    {
      id: 'fleet',
      label: 'Fleet',
      groupId: 'automate',
      icon: 'cpu',
    },
  ],
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const extensions: ExtensionManifest[] = [
  resolverExtension,
  litellmExtension,
  oapExtension,
  mcpExtension,
  securityAuditExtension,
  fleetExtension,
]
