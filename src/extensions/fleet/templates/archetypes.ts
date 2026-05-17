/**
 * Role archetype manifest mirror (#376 PR C).
 *
 * The canonical archetype library lives in ender-stack at
 * `services/companion/openclaw/workspace-defaults/archetypes/<slug>/manifest.json`
 * and is baked into the OpenClaw companion Docker image. MC needs the
 * same metadata at form-render time to:
 *
 *   1. Populate the create-agent form's archetype select dropdown
 *   2. Render the preview card describing what the agent will be like
 *   3. Server-side allowlist-check the submitted slug against known
 *      archetypes before emitting AGENT_ARCHETYPE on the task-def
 *
 * For v1 we keep a hand-maintained MC-side copy rather than fetching
 * the manifests from the companion image at runtime. The cross-repo
 * coupling is explicit + reviewable, and the static array avoids a
 * boot-time network dependency on the companion image registry.
 *
 * SYNC PROTOCOL: when adding / renaming / removing an archetype in
 * ender-stack, update this array in the same change set. The unit tests
 * (`__tests__/templates-openclaw.test.ts`) assert the slug emitted on
 * the task-def env array matches one of these slugs; a drift between
 * MC and the companion image would surface as a test failure at the
 * MC PR boundary.
 *
 * A future #324 (MCP architecture) follow-up will switch this to
 * fetching the manifests from a static asset baked into the companion
 * image — when operator-uploadable archetypes ship, that fetch path
 * becomes the source of truth. The static array stays only until then.
 */

import { ARCHETYPE_SLUG_RE } from './constraints'

export interface ArchetypeManifest {
  slug: string
  displayName: string
  description: string
  suggestedTools: string[]
}

/**
 * Allowlisted archetypes. The slug field MUST match the directory name
 * under `workspace-defaults/archetypes/` in ender-stack. The displayName
 * is what surfaces in the form's select control.
 *
 * `custom` is the explicit "no archetype" choice — operator-supplied
 * persona text becomes the entire role-shaping signal. init-config.sh
 * falls through to the base workspace-defaults templates when
 * AGENT_ARCHETYPE=custom (the dir is empty of `.md` files).
 */
export const ARCHETYPES: ArchetypeManifest[] = [
  {
    slug: 'technical-support',
    displayName: 'Technical Support Engineer',
    description:
      'Customer-facing troubleshooting, ticket triage, escalation. Patient, systematic, documentation-first.',
    suggestedTools: ['zendesk', 'linear', 'kb-search', 'internal-docs'],
  },
  {
    slug: 'software-engineer',
    displayName: 'Software Engineer',
    description:
      'Code, architecture, reviews, debugging. Direct, evidence-based, test-before-ship.',
    suggestedTools: ['github', 'code-search', 'terminal', 'ci-cd'],
  },
  {
    slug: 'go-to-market',
    displayName: 'Go-to-Market',
    description:
      'Strategy, positioning, competitive intel, launch planning. Strategic, market-aware, cross-functional.',
    suggestedTools: ['crm', 'competitive-intel', 'docs', 'analytics'],
  },
  {
    slug: 'revops',
    displayName: 'RevOps',
    description:
      'Pipeline ops, data hygiene, workflow automation, reporting. Process-oriented, metric-driven, automation-first.',
    suggestedTools: ['hubspot', 'salesforce', 'spreadsheets', 'data-pipelines'],
  },
  {
    slug: 'sdr',
    displayName: 'SDR',
    description:
      'Outbound prospecting, lead qualification, meeting booking. High-energy, concise, personalization-focused.',
    suggestedTools: ['crm', 'email', 'linkedin', 'enrichment'],
  },
  {
    slug: 'account-executive',
    displayName: 'Account Executive',
    description:
      'Deal management, proposals, negotiations, forecasting. Consultative, relationship-aware, deal-stage disciplined.',
    suggestedTools: ['crm', 'docs', 'calendar', 'proposal-tools'],
  },
  {
    slug: 'operations',
    displayName: 'Operations',
    description:
      'Process management, cross-functional coordination, reporting. Organized, systematic, deadline-aware.',
    suggestedTools: ['project-mgmt', 'spreadsheets', 'comms', 'docs'],
  },
  {
    slug: 'custom',
    displayName: 'Custom (free-form)',
    description:
      'No archetype scaffold. The operator-supplied persona becomes the entire role definition.',
    suggestedTools: [],
  },
]

/**
 * Slug → manifest lookup. Used by the form's preview card and by the
 * server-side allowlist check in `api/agents.ts` to confirm a submitted
 * `archetype` value matches a known archetype.
 *
 * Guard against an entry whose slug doesn't pass ARCHETYPE_SLUG_RE —
 * the regex is the load-bearing security control on the
 * `AGENT_ARCHETYPE` env var that init-config consumes to resolve a
 * directory path. A bad slug in ARCHETYPES would silently bypass the
 * server-side regex check (since the allowlist match would succeed)
 * and could land an unsafe value on the task-def. Module-load-time
 * assert catches the regression in the test suite.
 */
for (const a of ARCHETYPES) {
  if (!ARCHETYPE_SLUG_RE.test(a.slug)) {
    throw new Error(
      `archetypes.ts: slug "${a.slug}" fails ARCHETYPE_SLUG_RE — fix in source before shipping`,
    )
  }
}

export const ARCHETYPE_SLUGS: ReadonlySet<string> = new Set(
  ARCHETYPES.map((a) => a.slug),
)

export const ARCHETYPE_BY_SLUG: ReadonlyMap<string, ArchetypeManifest> =
  new Map(ARCHETYPES.map((a) => [a.slug, a]))
