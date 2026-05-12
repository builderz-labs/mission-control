/**
 * Upstream-touched files allowlist for the fork-contract byte-clean test.
 *
 * Three buckets, all currently grandfathered as "approved" so the test
 * passes on main. The point of this allowlist is to be a forward-looking
 * RATCHET: new PRs that introduce upstream-touch beyond these paths fail
 * the gate. Existing legacy entries should burn down over time
 * (see ender-stack#331).
 *
 * To find any bucket's surface area:
 *   git grep "documented fork override" .            # bucket 1
 *   git grep "intentional fork addition" .           # bucket 2
 *   git grep "LEGACY DEBT" .                         # bucket 3
 *
 * When a bucket-3 file is cleaned up (relocated to src/extensions/,
 * upstreamed, or reverted), delete its entry here. The fork-contract
 * test will then fail loudly if anyone re-touches it without updating
 * this list, which is the ratchet working.
 */
export const APPROVED_UPSTREAM_TOUCH_PATHS = [
  // ── Bucket 1: documented fork override (FORK.md "Hard Rules" §2) ──
  'src/lib/db.ts',
  'src/app/layout.tsx',
  'src/proxy.ts',
  'src/i18n/request.ts',
  'src/components/layout/nav-rail.tsx',

  // ── Bucket 2: intentional fork addition — route shim ──
  // Next.js App Router shims that re-export handlers from
  // src/extensions/<area>/api/. FORK.md describes the pattern but doesn't
  // enumerate the shim files; this is the canonical list.
  'src/app/api/audit/route.ts', // oap /audit
  'src/app/api/mcp-audit/verify/route.ts', // mcp
  'src/app/api/security-audit/route.ts', // security-audit

  // ── Bucket 3: LEGACY DEBT — cleanup tracked in ender-stack#331 ──
  // Files modified relative to upstream/main that pre-date the
  // FORK.md restoration in PR #320 / mc-fork#63. Each should be
  // either (a) relocated to src/extensions/, (b) upstreamed to
  // builderz-labs/mission-control, or (c) reverted to upstream.
  // Until then, they're grandfathered so the test passes on main —
  // but the gate prevents the count from growing.

  // LEGACY DEBT (ender-stack#331): src/lib/ undocumented divergence
  'src/lib/scheduler.ts',
  'src/lib/recurring-tasks.ts',
  'src/lib/openclaw-gateway.ts',
  'src/lib/validation.ts',
  'src/lib/token-pricing.ts',
  'src/lib/config.ts',
  'src/lib/command.ts',
  'src/lib/device-identity.ts',
  'src/lib/claude-sessions.ts',
  'src/lib/gateway-url.ts',
  'src/lib/injection-guard.ts',
  'src/lib/use-server-events.ts',
  'src/lib/task-dispatch.ts',

  // LEGACY DEBT (ender-stack#331): src/lib/__tests__/ paired with above
  'src/lib/__tests__/gateway-url.test.ts',
  'src/lib/__tests__/injection-guard.test.ts',
  'src/lib/__tests__/openclaw-gateway.test.ts',
  'src/lib/__tests__/token-pricing.test.ts',
  'src/lib/__tests__/validation.test.ts',

  // LEGACY DEBT (ender-stack#331): src/app/ page-level divergence
  'src/app/[[...panel]]/page.tsx',
  'src/app/login/page.tsx',

  // LEGACY DEBT (ender-stack#331): src/app/api/ upstream feature modifications
  // (NOT route shims — these are upstream routes the fork has diverged on)
  'src/app/api/agents/route.ts',
  'src/app/api/agents/[id]/route.ts',
  'src/app/api/openclaw/doctor/route.ts',
  'src/app/api/pipelines/route.ts',
  'src/app/api/sessions/route.ts',
  'src/app/api/sessions/continue/route.ts',
  'src/app/api/sessions/transcript/route.ts',
  'src/app/api/sessions/__tests__/transcript-opencode.test.ts',
  'src/app/api/tasks/route.ts',
  'src/app/api/tasks/[id]/route.ts',
  'src/app/api/tokens/route.ts',

  // LEGACY DEBT (ender-stack#331): src/components/ upstream component divergence
  'src/components/chat/chat-workspace.tsx',
  'src/components/panels/agent-detail-tabs.tsx',
  'src/components/panels/task-board-panel.tsx',
  'src/components/panels/user-management-panel.tsx',

  // LEGACY DEBT (ender-stack#331): companion to approved src/proxy.ts
  'src/proxy.test.ts',
] as const
