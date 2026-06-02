# Extensions Inventory — stroupaloop/mission-control

This is the per-namespace inventory for everything under `src/extensions/`. It complements [`FORK.md`](FORK.md) (which states the policy / hard rules) with concrete content per extension. Extensions are AMS-specific and never propagate upstream; see FORK.md for why.

## Upstream-Touch Contract (rebase surface)

Per FORK.md: only **five** upstream files may be modified. These are the entire interface between the fork's customizations and the upstream `builderz-labs/mission-control` baseline:

| File | What we add | Why |
|---|---|---|
| `src/lib/db.ts` | One call to `mountExtensions()` (registers extension API routes, startup hooks, scheduled tasks against the upstream router) | Upstream's DB module is the canonical boot point; mounting here ensures extensions activate before first request |
| `src/app/layout.tsx` | One-line `<ClientBoot />` render | Next.js App Router has separate server + client module graphs. ClientBoot is the side-effect hook that registers panel components into the client `componentMap` and the nav items into `registerNavItems` |
| `src/proxy.ts` | Allowlist for server-to-server ingest paths (e.g. `/api/litellm/usage`) so per-route bearer-token auth runs instead of the session/API_KEY gate | Upstream's middleware enforces session/API_KEY for every `/api/*` request. Extensions that own ingest endpoints with their own auth model (LiteLLM `generic_api` callback, future webhook integrations) need a path-specific bypass; the proxy is the only place this can express |
| `src/i18n/request.ts` | One `Promise.all` + spread that merges `loadExtensionMessages(locale)` into the next-intl message bag | Extension namespaces (`oapApprovals`, `litellmUsage`, etc.) live in `src/extensions/i18n/locales/{locale}.json` so upstream `messages/*.json` stays byte-clean. The merge call site has to sit in `request.ts` because next-intl resolves the message bag exactly once per request through `getRequestConfig`. |
| `src/components/layout/nav-rail.tsx` | `resolvePluginIcon()` helper + `pluginItems` rendering path to map extension manifest icon-name strings to SVG components | The nav-rail is where plugin items are injected into sidebar groups. The extension manifest can only carry string icon names (keeping it safe for the server graph); the mapping to React nodes must live in the client-side nav. Long-term direction: manifest should supply `React.ReactNode` directly, removing this touch point. |

**Anything outside these five files is a violation of FORK.md** and requires explicit owner approval. When rebasing against `builderz-labs/main`, conflicts on these five files are the canonical resolution surface — everything else should rebase cleanly because all custom code lives in `src/extensions/` (a directory upstream doesn't touch).

**Long-term direction for `src/proxy.ts`:** the bypass list should ultimately be derived from `loadExtensionManifest()` (e.g. a `bypassProxyAuth?: string[]` field per extension) so adding new ingest endpoints stays inside `src/extensions/`. Until that hook exists, each new bypass entry is an explicit owner-approved touch.

## Extension Architecture

The fork's `src/extensions/extensions.config.ts` is the **authoritative manifest** for what gets registered at boot:

- **`apiRoutes`** — per-extension API handlers, surfaced under `/api/<area>/...` via 5-line shim files in `src/app/api/<area>/route.ts`.
- **`startupHooks`** — `() => void | Promise<void>` functions run once before first request.
- **`scheduledTasks`** — recurring tasks registered with the MC scheduler.
- **`panels`** — UI panels client-registered via `client.ts` (populates `componentMap`, calls `registerPanel` + `registerNavItems`).

If an extension isn't listed in the manifest, its hooks/tasks/routes don't fire — even if the files exist on disk.

`src/extensions/extensions.config.ts.types.ts` is a pure type-only module that can be imported safely from either the server graph or the client graph (no Next.js bundler boundary issues). `src/extensions/manifest.client.ts` mirrors the server manifest's client-visible fields without dragging server code through to the browser bundle.

## Inventory

### `resolver/` — Resolver Intelligence

Per-tool resolver telemetry, drift detection, override management, model-recommendation panels.

- **`telemetry.ts`** — `ingestResolverTelemetry`, `rebuildResolverDailyMetrics`, `ensureResolverTables`. The 60-second tick (`RESOLVER_TICK_MS`) tails the resolver JSONL log and ingests new rows.
- **`drift-alerts.ts`** — detects model drift in resolver behavior; emits alerts via the MC notification surface.
- **`overrides.ts`** — manage tool-level confidence overrides (CRUD).
- **`recommendations.ts`** — surface model-routing recommendations driven by historical telemetry.
- **`weekly-ingest.ts`**, **`quarterly-ingest.ts`** — scheduled rollup tasks for cost/usage history.
- **`panels/`** — `/resolver-intelligence` (live metrics + tools narrowed) and supporting sub-views.
- **`api/`** — `/api/resolver/{metrics,recent,timeseries,benchmark,overrides,recommendations,...}`.
- **Tables** — `resolver_metrics_daily`, `resolver_telemetry`.

### `oap/` — OAP Audit & Approvals Bridge

Ingest endpoint for OAP-signed audit records, plus the human-in-the-loop approval bridge.

- **`api/audit/`** — replaces upstream `/api/audit`; verifies Ed25519 signatures from OAP sidecars and writes to `audit_events`.
- **`api/approvals/`** — `/api/oap/approvals` GET/POST for the Telegram/Slack approval bridge.
- **`panels/`** — `/oap-approvals` (pending approvals queue) and `/oap-audit` (signed audit trail).
- **Tables** — `audit_events`.

### `litellm/` — LiteLLM Cost & Usage

Aggregated business-level rollups over LiteLLM's per-call telemetry. *Not* a substitute for Langfuse's per-call tracing — these are per-tenant budget views and multi-agent cost summaries.

- **`usage.ts`** — `/api/litellm/usage` POST handler (target of LiteLLM's `generic_api` callback once re-enabled in ender-stack).
- **`attribution.ts`** — per-tenant + per-agent cost attribution logic.
- **`panels/`** — `/litellm-usage` (rollup tables, attribution dashboards).
- **`api/dashboard/`** — `/api/litellm/dashboard/{records,summary}`.
- **Tables** — `litellm_usage`.

### `mcp/` — MCP Audit Pipeline

Audit support for MCP (Model Context Protocol) tool invocations. Tighter scope than OAP — focused on tool call provenance.

- **`audit.ts`** — verification + storage logic for MCP-stamped audit events; replaces upstream `/api/mcp-audit/verify`.
- **`api/`** — verification endpoints.

### `security-audit/` — Scheduled Security Scans

Recurring security scans across the deployment surface. API-only (no panels yet); results written to a structured table for downstream consumers.

- **`api/`** — `/api/security-audit/...` replacing upstream `security-audit/route.ts` with the extension version.

### `fleet/` — Production-Deployed Agents (ECS)

Read-only view of agent harnesses (OpenClaw companions, Hermes workers, future harness types) deployed to ECS in this cluster. Phase-2.0 of the ender-stack vertical-slice rollout — deploy + configure + observe controls land in subsequent phases (2.1+). Calls AWS SDK ECS server-side using the MC task role's IAM grant (`ecs:ListServices` + `ecs:DescribeServices`, scoped to the configured cluster — provisioned in ender-stack PR #150).

- **`api/services.ts`** — `GET /api/fleet/services`. Auth-gated by `requireRole(request, 'viewer')`. Calls `DescribeServices` with `include: ['TAGS']` and **always filters server-side** to services tagged `Component=agent-harness`. Platform services (Mission Control, LiteLLM, Langfuse, Mem0) and untagged services are excluded by design — Fleet is the agent-control-plane page, not a cluster-wide service inventory. `taskDefinition` ARNs are stripped to `family:revision` at the response boundary so the AWS account ID never reaches the browser.
- **`api/redeploy.ts`** (Phase 2.1) — `POST /api/fleet/services/:name/redeploy`. Auth-gated by `requireRole(request, 'operator')`. Pre-flights with `DescribeServices include: ['TAGS']` and **404s unless the target carries `Component=agent-harness`** (the IAM grant from ender-stack PR #187 is cluster-scoped, so this handler is the only thing keeping operators away from platform services). Then calls `UpdateService` with **only** `{ forceNewDeployment: true }` — never forwards client-supplied fields (IAM can't restrict UpdateService params; the handler must). 202 on success; 404 on not-found / not-harness / inactive; 502 on other SDK errors with error name only.
- **`panels/fleet-panel.tsx`** — `FleetPanel`. Header is "Fleet". Table view (status, counts, launch type, in-progress deployments) with a per-row **Redeploy** button (Phase 2.1). Button disabled while the POST is in flight or when ECS already shows `activeDeployments > 0` — re-enables automatically when ECS reports COMPLETED on the next refresh (no per-row "rolling" state in MC; ECS is the source of truth).
- **`MC_FLEET_CLUSTER_NAME`** — env var, defaults to `ender-stack-dev`.
- **`templates/openclaw.ts` + `api/agents.ts`** — `POST /api/fleet/agents` renders + registers each MC-created agent's ECS task-def. **EFS-backed agent state (#559):** the `config` + `workspace` volumes attach `efsVolumeConfiguration` (per-agent access point, `transitEncryption: ENABLED`, `iam: DISABLED`) so memory/sessions/skills/persona survive task restarts — they were ephemeral `host:{}` volumes that wiped on every launch (and 404'd MC's persona editor, #92). `plugin-deps` stays ephemeral. The init container runs the bundled `/usr/local/bin/init-config.sh` as the `node` user (no root chown), identical to the Terraform smoke-test, because the access points' `posixUser=1000` owns the mount.
  - **Cross-repo env contract (set by `terraform/modules/mission-control`):**
    - **`MC_AGENT_EFS_FILE_SYSTEM_ID`** — EFS file system id the agent volumes bind. Required for all agents (fail-fast `getMissingEnv` → 500).
    - **`MC_AGENT_EFS_ACCESS_POINTS`** — JSON map `{ "<agent>": { "config": "fsap-…", "workspace": "fsap-…" } }`, keyed by agent name. Access points are **pre-provisioned in ender-stack Terraform** (`companion_openclaw_efs_agents`); MC does **not** create access points at runtime (no `elasticfilesystem:CreateAccessPoint` grant — that would widen MC's blast radius on the persona-write surface, ender-stack#555/#558). Failure modes: an **absent or malformed** map (Terraform hasn't published it) is a fleet-level `getMissingEnv` → **500** (every create would fail); an agent **absent from a valid** map, or one whose `config`/`workspace` isn't a well-formed `fsap-` id, is a per-agent **422** before any resource is created. Runtime dynamic provisioning is the deferred Phase-2 path (ender-stack#137).

Distinct from upstream's `/agents` page which serves the local/docker dev-iteration story. The two surfaces stay separate by deliberate choice (see Phase-2 plan locked decisions: extending upstream `/agents` for ECS deploys would breach the 2-touchpoint contract). When MC has its own deploy/configure flow (Phase 2.2+), `/agents` will be hideable behind `MC_HIDE_UPSTREAM_AGENTS` env flag.

**Companion ender-stack convention**: agent harness modules tag their `aws_ecs_service` resources with `Component = "agent-harness"`; platform services (LiteLLM, MC, etc.) carry `Component = "platform-service"`. The filter is mandatory and always-on, so **any new ECS module that should render in Fleet MUST declare `Component = "agent-harness"`**. Untagged services and `platform-service`-tagged services don't appear.

## Tables Touched By Extensions

These tables are owned by the extension layer (created in extension `startupHooks` or via the database initialization path). They live alongside upstream's tables in the same SQLite database (`/app/.data/`) on dev deployments.

| Extension | Tables |
|---|---|
| `resolver` | `resolver_metrics_daily`, `resolver_telemetry` |
| `oap` | `audit_events` |
| `litellm` | `litellm_usage` |

If/when MC needs cross-service queries or multi-instance HA, the migration path is an opt-in adapter at `src/extensions/db-adapter/` — an extension layer that can target SQLite (default) or Postgres (via `DATABASE_URL`). This preserves the two-touch-points rebase contract — upstream's `src/lib/db.ts` stays untouched.

## Adding a New Extension

1. Create `src/extensions/<your-extension>/` with at minimum:
   - `index.ts` (or whatever entry your manifest references)
   - `api/` for HTTP handlers
   - `panels/` for UI components (optional)
2. Add an entry to the `extensions: ExtensionManifest[]` array in `src/extensions/extensions.config.ts`.
3. If you have panels, also add them to `src/extensions/manifest.client.ts` (client-graph mirror) and import the components in `src/extensions/client.ts`.
4. If you add API shims under `src/app/api/<area>/route.ts`, keep them ≤5 lines — they should delegate straight to the extension's handler.
5. **Do not** modify any file outside `src/extensions/` other than the five upstream-touch points (and only if absolutely necessary).

## Rebasing Against `builderz-labs/main`

Per FORK.md procedure, with concrete contract:

1. `git fetch upstream` (assumes `upstream` is `git@github.com:builderz-labs/mission-control.git`).
2. `git rebase upstream/main` on this fork's main.
3. **Conflicts should appear in at most these files**:
   - `src/lib/db.ts` (extension mount line; resolve by keeping our line + upstream's changes)
   - `src/app/layout.tsx` (`<ClientBoot />` line; same)
   - `src/proxy.ts` (the public-paths allowlist block immediately below the CSRF Origin check — keep our ingest-bypass clauses + upstream's other changes; the variable names may evolve, find the block by its `isPublicHealthProbe` neighbor)
   - Anything under `src/extensions/` (only ours; no upstream changes)
4. Anywhere else, conflicts are a sign that an extension grew tendrils outside the contract — investigate before resolving.
5. `pnpm test`, then run the docker image and verify the four panel routes (`/resolver-intelligence`, `/oap-approvals`, `/oap-audit`, `/litellm-usage`) load with live data.
6. Tag and push to GHCR via `docker-publish.yml`.

## Translation Notes

Extension panel UI strings live in `messages/<lang>.json` under namespaced keys (e.g. `extensions.resolver.*`, `extensions.oap.*`). The scripts at `scripts/{translate_extension_namespaces,qa_review_translations,add_extension_translations}.py` automate adding new keys across all locales. When adding a new panel, run those scripts before opening a PR.
