/**
 * GET /api/epl/start-here
 *
 * "START HERE" data feed — onboarding any new contributor (Gerda's other laptop,
 * EPL team accounts e.g. Arianne / Kris / Jose, future Staylio Claude, new
 * Claude Code session). Returns:
 *   - intro:           one-liner + how-to-use
 *   - agents[]:        each of 15 agents — purpose · category · key integrations ·
 *                      repo path · how to pick up · blocked-on
 *   - integrations[]:  cross-cutting services (Gmail, Slack, Hetzner, etc.)
 *                      and which agents depend on them
 *   - references[]:    canonical sheets, dashboards, repos
 *   - how_to_add_agent: step-by-step for spinning up a new agent
 *
 * Authored as the canonical "read first" panel. The 15-agent purposes
 * mirror /api/epl/agents (same roster) but expand to *why it exists* and
 * *how to pick it up* — agents/route.ts answers "is it healthy"; this
 * answers "what is it for and where do I start".
 *
 * Source of truth for purposes + integrations:
 *   - ~/.claude/projects/-Users-gerdamicke/memory/MEMORY.md (Gerda's auto-memory)
 *   - per-agent ~/<agent>/ROADMAP.md
 *   - reference_team_roster.md
 */

import { NextResponse } from 'next/server'

interface AgentEntry {
  name: string
  emoji: string
  role: string
  category: string
  purpose: string
  key_integrations: string[]
  repo_path: string
  how_to_pick_up: string
  blocked_on: string | null
}

interface Integration {
  name: string
  used_by: string[]
  who_owns: string
  setup_notes: string
}

interface Reference {
  name: string
  url: string
  purpose: string
}

const AGENTS: AgentEntry[] = [
  {
    name: 'sofia',
    emoji: '📨',
    role: 'Email PA',
    category: 'PA',
    purpose: 'Drafts inbox replies — listens to all 3 EPL/NourNest/Gerda Gmail inboxes, classifies by legal status (RentersRightsBill, lease, etc.), drafts reply, holds for Gerda 1-tap send. Never auto-sends.',
    key_integrations: ['Gmail OAuth (gerda@ + 2 others)', 'Anthropic API', 'PostgreSQL state', 'PM2 on VPS /opt/sofia'],
    repo_path: '~/sofia/  (deployed to VPS /opt/sofia)',
    how_to_pick_up: 'Read ROADMAP.md → check processor.ts:6 for legal-status + owner-already-replied guards → run `npm test` (10 vitest cases must pass). Last shipped: db8e39e owner-replied guard 27 May.',
    blocked_on: null,
  },
  {
    name: 'iris',
    emoji: '⭐',
    role: 'Property QA / Guest Experience',
    category: 'QA',
    purpose: 'Guest-experience loop — drives review-driven improvements per flat. Reactive sibling to Owen (proactive). Per-flat Asana project 1215136647884750.',
    key_integrations: ['Asana MCP', 'BOOM guidebook style guide v1.2', 'larry_accessor.py'],
    repo_path: '~/iris/',
    how_to_pick_up: 'Read ROADMAP.md → check 26 May Guest Experience Loop v2 spec → Phase 2a paused on Zain Euston 1 sample.',
    blocked_on: 'Zain Euston 1 sample data',
  },
  {
    name: 'hugo',
    emoji: '🔧',
    role: 'Maintenance dispatch',
    category: 'Maintenance',
    purpose: 'Maintenance ticket router — receives WhatsApp + email maintenance requests, classifies P0/P1/P2/P3, dispatches to handyman/plumber/electrician via WhatsApp, tracks resolution. Currently 12 open (1 P0 · 3 P1).',
    key_integrations: ['Green API (WhatsApp)', 'Gmail OAuth (maintenance@)', 'BOOM PMS (canonical bookings)', '/api/stats endpoint'],
    repo_path: '~/hugo/',
    how_to_pick_up: 'Read ROADMAP.md → /api/stats LIVE via MC self-stub (proxy works locally) → Real Hugo just swaps URL when VPS deploys. Pending: Green API signup + VPS deploy.',
    blocked_on: 'Green API signup (Gerda 30-min unblock)',
  },
  {
    name: 'aria',
    emoji: '💡',
    role: 'Pricing / PriceLabs',
    category: 'Pricing',
    purpose: 'Daily comp-pricing scan — for all 50 properties, pulls neighbouring listings via DataForSEO + PriceLabs, recommends nightly prices. Writes to Google Sheet, syncs to PriceLabs on Gerda approval.',
    key_integrations: ['DataForSEO MCP', 'PriceLabs API', 'BOOM canonical listings', 'google-sheets MCP'],
    repo_path: '~/aria/',
    how_to_pick_up: 'Read ROADMAP.md → scheduled task runs autonomously each AM → cache at data/comp_pricing_cache.json + parity check Mac/VPS. Waiting on Hanna replacement to approve syncs.',
    blocked_on: 'Hanna replacement (Jose can own when onboarded)',
  },
  {
    name: 'james',
    emoji: '💰',
    role: 'Finance / P&L',
    category: 'Finance',
    purpose: 'Monthly P&L generator + anomaly detection. Pulls bank transactions + invoices, categorises, flags variance >10%. Writes to Google Sheets.',
    key_integrations: ['QuickBooks API', 'google-sheets MCP', 'Bank CSV imports'],
    repo_path: '~/james/',
    how_to_pick_up: 'Read ROADMAP.md → Q1 P&L refresh complete, 1 anomaly flagged. Phase 2: bank reconciliation (Jose owns ±10% + reconciliation per delegation framework).',
    blocked_on: null,
  },
  {
    name: 'leo',
    emoji: '📣',
    role: 'Marketing / GEO',
    category: 'Marketing',
    purpose: 'AI-search visibility (GEO) monitor — tracks brand mentions across ChatGPT, Perplexity, Gemini, AI Overviews. Scores citability, monitors competitors.',
    key_integrations: ['Anthropic API', 'Perplexity API', 'DataForSEO', 'Slack #marketing'],
    repo_path: '~/leo/',
    how_to_pick_up: 'Read ROADMAP.md → 2 SEO posts pending Gerda review. Uses skill `marketing-geo`.',
    blocked_on: null,
  },
  {
    name: 'victoria',
    emoji: '💼',
    role: 'Revenue / direct bookings',
    category: 'Revenue',
    purpose: 'Direct-booking funnel optimisation — landing page A/B tests, conversion tracking, abandoned-cart sequences for EPL direct site.',
    key_integrations: ['Stripe', 'EPL direct site', 'Email sequences'],
    repo_path: '~/victoria/',
    how_to_pick_up: 'Read ROADMAP.md (currently stale ~8d — refresh first).',
    blocked_on: null,
  },
  {
    name: 'marcus',
    emoji: '🛡',
    role: 'Compliance / legal',
    category: 'Compliance',
    purpose: 'Watches Renters Rights Bill + UK STR regulation changes. Surfaces lease clauses needing updates, flags compliance debt.',
    key_integrations: ['UK gov.uk feeds', 'Legal docs in Drive'],
    repo_path: '~/marcus/',
    how_to_pick_up: 'Read ROADMAP.md → 13 May TBD compensation still in force.',
    blocked_on: null,
  },
  {
    name: 'atlas',
    emoji: '🧭',
    role: 'Chief of Staff',
    category: 'CoS',
    purpose: 'Daily brief composer + standup orchestrator. Writes morning brief from all `/api/epl/*`, cron-posts to Slack 07:00 BST. Writes heartbeat to /opt/atlas/data/last_heartbeat.json (mounted into MC).',
    key_integrations: ['Slack webhook', 'All EPL agent /api/stats', 'cron 0 7 * * *', 'MC /api/epl/atlas-brief'],
    repo_path: '~/atlas/  (deployed to VPS /opt/atlas)',
    how_to_pick_up: 'Read ROADMAP.md → cron LIVE (writes /var/log/atlas-brief.log) → drop BRIEF_DRY_RUN=1 to flip Slack live. Heartbeat: mounted via docker volume.',
    blocked_on: null,
  },
  {
    name: 'edward',
    emoji: '🪐',
    role: 'Meta systems architect',
    category: 'Meta',
    purpose: 'Friday scan over all 16 agents — flags stale ROADMAPs (>7d), detects registry gaps (e.g. flat in Sofia but not Hugo), proposes architectural fixes. Writes proposals to MC Decisions panel as Architecture-category.',
    key_integrations: ['Per-agent ROADMAPs (read-only)', 'MC /api/epl/decisions (POST)', 'cron Friday 09:00'],
    repo_path: '~/edward/',
    how_to_pick_up: 'Read ROADMAP.md + specs/registry_gap_detector.md → 5 proposals awaiting Gerda. Last shipped 27d99e0 registry_gap_scanner.py 27 May.',
    blocked_on: null,
  },
  {
    name: 'cleo',
    emoji: '💵',
    role: 'Cash Flow Guardian',
    category: 'Cash',
    purpose: '14-day rolling cash forecast — pulls bank balance + scheduled invoices/expenses, projects 14-day runway. Flags when below threshold.',
    key_integrations: ['QuickBooks', 'Bank API', 'james agent for P&L baseline'],
    repo_path: '~/cleo/',
    how_to_pick_up: 'Read ROADMAP.md → 14-day forecast +£3.2k vs plan.',
    blocked_on: null,
  },
  {
    name: 'larry',
    emoji: '🤝',
    role: 'Landlord Relations',
    category: 'Landlord',
    purpose: 'Landlord communication + property accessor. Has sibling accessors for each landlord. Shares property_aliases_cache.json with Nina via symlink (single source of truth).',
    key_integrations: ['property_aliases_cache.json (symlinked with nina)', 'Email PA via Sofia handoff'],
    repo_path: '~/larry/',
    how_to_pick_up: 'Read ROADMAP.md → 5 sibling accessors complete, scan-triggers live. larry_accessor.py shipped 22 May.',
    blocked_on: null,
  },
  {
    name: 'nina',
    emoji: '🌱',
    role: 'Onboarding (50-task)',
    category: 'Onboarding',
    purpose: 'New-flat onboarding orchestrator — 50-step checklist (BOOM setup, PriceLabs config, photography, listings, key handover). Shares property registry with Larry.',
    key_integrations: ['BOOM PMS', 'PriceLabs', 'Photography vendor', 'property_aliases_cache.json (symlinked with larry)'],
    repo_path: '~/nina/',
    how_to_pick_up: 'Read ROADMAP.md → 2 new flats in pipeline (Shoreditch 3, Five Balfour Flat 2). Cache 70→74 properties.',
    blocked_on: null,
  },
  {
    name: 'nathan',
    emoji: '📊',
    role: 'Deal analysis (rent-to-rent SA)',
    category: 'Acquisition',
    purpose: 'Scores rent-to-rent serviced-accommodation deals — GO/REVIEW/NO GO verdicts vs EPL portfolio benchmarks (44-property calibration). Uses `deal-analysis` skill.',
    key_integrations: ['Skill: deal-analysis', 'BOOM portfolio data'],
    repo_path: '~/nathan/',
    how_to_pick_up: 'Read ROADMAP.md → Hill House counter-offer drafted. NB: ROADMAP misnamed (rename pending).',
    blocked_on: null,
  },
  {
    name: 'owen',
    emoji: '🔬',
    role: 'Guest-area research',
    category: 'Research',
    purpose: 'Proactive sibling to Iris — daily-fills Per-Flat Enrichment Queue v2 sheet from web search + LLM curation. 13 query types (council_tax, halal_restaurants, family_kids_activities, etc.). Monthly digest to #operations.',
    key_integrations: ['Google Places API', 'Anthropic API (prompt cache)', 'Per-Flat Enrichment Queue v2 sheet', 'Slack #operations'],
    repo_path: '~/owen/',
    how_to_pick_up: 'Read ROADMAP.md → 118 tests · 91% coverage · feature-complete code-wise. Phases 0→5 all SHIPPED. 5 Gerda gates open: name approval · v2 sheet share · Slack channel · £10-20/mo budget · cadence.',
    blocked_on: '5 Gerda activation gates (not code)',
  },
]

const INTEGRATIONS: Integration[] = [
  { name: 'Gmail OAuth', used_by: ['sofia', 'hugo'], who_owns: 'Gerda', setup_notes: '3 inboxes: gerda@elitepropertylondon.co.uk · maintenance@ · nournest. OAuth tokens in agent .env. Rotate via Google Cloud Console.' },
  { name: 'Slack', used_by: ['atlas', 'owen', 'leo'], who_owns: 'Gerda (DM D02BH5NCGTD)', setup_notes: 'Bot token + webhook. Channels: #operations (Owen) · #marketing (Leo) · DM (Atlas brief).' },
  { name: 'Anthropic API', used_by: ['sofia', 'owen', 'leo', 'atlas'], who_owns: 'Gerda billing', setup_notes: 'Single billing key. Prompt caching enabled where supported.' },
  { name: 'Gemini API', used_by: ['atlas (research)'], who_owns: 'Gerda personal (gerdamicke@gmail.com)', setup_notes: 'Free tier `gemini-2.5-flash` 250 req/day. Stored in macOS Keychain → ~/.zshrc env var. Production agents need separate billed key in dedicated GCP project (TODO).' },
  { name: 'Hetzner Cloud', used_by: ['atlas', 'sofia', 'mc'], who_owns: 'Gerda', setup_notes: 'VPS 204.168.227.30 (CX23, eu-central, server id 125988828). Token in ~/.zshrc HETZNER_API_TOKEN — rotate via console.hetzner.cloud → Security.' },
  { name: 'Green API (WhatsApp)', used_by: ['hugo'], who_owns: 'pending Gerda signup', setup_notes: 'BLOCKER — Hugo deploy waits on this.' },
  { name: 'BOOM PMS', used_by: ['hugo', 'aria', 'nina', 'james'], who_owns: 'Boostly support@boostly.co.uk (call 2 Jun)', setup_notes: 'WP backend: stg-gerdamicke-staging35.kinsta.cloud. CAUTION: Boostly retains tom@/dev@/support@ admin access. Demote AFTER 2 Jun call.' },
  { name: 'PriceLabs', used_by: ['aria', 'nina'], who_owns: 'Gerda', setup_notes: 'API key in agent .env. Aria writes recommendations, syncs on approval.' },
  { name: 'DataForSEO', used_by: ['aria', 'leo'], who_owns: 'Gerda billing', setup_notes: 'Used for competitive pricing + SEO research.' },
  { name: 'Asana', used_by: ['iris'], who_owns: 'Gerda', setup_notes: 'Per-flat projects. Iris Guest Experience Loop = project 1215136647884750.' },
  { name: 'QuickBooks', used_by: ['james', 'cleo'], who_owns: 'Gerda', setup_notes: 'MCP server connected. Used for P&L + cash forecast.' },
  { name: 'Google Sheets', used_by: ['aria', 'james', 'owen', 'larry', 'nina'], who_owns: 'Gerda (claude-sheets SA)', setup_notes: 'Service account for read/write. Property Aliases sheet is the canonical registry.' },
]

const REFERENCES: Reference[] = [
  { name: 'Property Aliases sheet (registry)', url: 'https://docs.google.com/spreadsheets/d/1ES5mzhkUdx95nxe7YlLdSaj5M2SL4DtIbsMdqQwIkLw/edit', purpose: 'Canonical 74-row property registry. Larry+Nina share via cache symlink.' },
  { name: 'Per-Flat Enrichment Queue v2', url: 'https://docs.google.com/spreadsheets/d/1V54whZCiq6z1AX5HrrQCH05XJ62gHpedUnCJ0EgLdhI/edit', purpose: 'Owen daily-fills this sheet. 12 query types × 8 priority flats.' },
  { name: 'MC repo', url: 'https://github.com/gerdux1/mission-control', purpose: 'This dashboard. Deployed to mc.str-agents.com via docker on Hetzner.' },
  { name: 'MC fleet view', url: 'https://mc.str-agents.com/agents-fleet', purpose: 'Live agent health table. Open this BEFORE you touch any agent.' },
  { name: 'MC decisions', url: 'https://mc.str-agents.com/decisions', purpose: 'Architecture proposals from Edward + product decisions awaiting Gerda.' },
  { name: 'Atlas brief (markdown)', url: 'https://mc.str-agents.com/api/epl/atlas-brief?format=markdown&role=gerda', purpose: 'Morning brief composer. Cron posts to Slack 07:00 BST.' },
  { name: 'JOSE_HANDOFF.md', url: 'https://github.com/gerdux1/mission-control/blob/main/JOSE_HANDOFF.md', purpose: 'Onboarding doc for Jose week-1.' },
]

const HOW_TO_ADD_AGENT: string[] = [
  'Add `~/<name>/` repo, `ROADMAP.md` + `CLAUDE.md` (purpose · phase · next-3 · blocked · KPIs).',
  'If the agent will surface live stats: add `/api/stats` endpoint on the agent side (mirror Hugo shape).',
  'Register in MC: add FALLBACK row in src/app/api/epl/agents/route.ts + EMOJI in epl-agents-panel.tsx + ROADMAP_AGES bump in _helpers.ts.',
  'Register in Atlas: add to `config/agents.py` so heartbeat tracks it.',
  'Add to this page: append entry to AGENTS[] in src/app/api/epl/start-here/route.ts with purpose + integrations + how-to-pick-up.',
  'If new integration needed (new Slack channel, new API key, new sheet): append to INTEGRATIONS[] here so future contributors know who owns it.',
  'Smoke test: `curl https://mc.str-agents.com/api/epl/agents -H "x-api-key: $API_KEY"` should return the new agent.',
]

const HOW_TO_PICK_UP_EXISTING: string[] = [
  'Open mc.str-agents.com/agents-fleet — find agent, note ROADMAP age. Click for drawer.',
  'Click through to mc.str-agents.com/start-here (this page) — read purpose + key integrations + repo path.',
  '`cd ~/<agent>/` → read ROADMAP.md (phase · shipped · blocked · next-3 · KPIs).',
  '`cd ~/<agent>/` → read CLAUDE.md (build/test/deploy commands).',
  'Run tests: `npm test` or `pytest` per CLAUDE.md. Verify green before changes.',
  'Check recent commits: `git log --oneline -20` — last 2 weeks of context.',
  'If integration creds needed (Gmail OAuth, API keys): check Integrations table on this page for owner — ask Gerda or read agent .env.example.',
  'Update ROADMAP.md when you ship (Edward Friday scan flags >7d stale).',
]

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    intro: {
      who_should_read: 'You — if this is your first session in this codebase. Gerda\'s other laptop, EPL team accounts (Arianne / Kris / Jose), future Staylio Claude, any cold-start Claude Code session.',
      one_liner: 'EPL runs ~16 autonomous agents. Mission Control (mc.str-agents.com) is the shared brain. Read this page BEFORE building anything — most likely an agent already exists for what you have in mind.',
      principles: [
        'Memory is per-laptop, MC is shared. Your Claude Code memory only lives on the Mac you\'re on — MC is the team source of truth.',
        'Property registry is canonical. Property Aliases sheet is the only source. Cache is symlinked between Larry + Nina.',
        'BOOM is canonical for bookings. PriceLabs is canonical for occupancy. James/Cleo for £. Hugo for maintenance. Don\'t duplicate.',
        'Agents never auto-send to humans. Sofia drafts but doesn\'t send. Hugo proposes but Gerda approves. MC Decisions panel shows held proposals.',
        'ROADMAP.md per agent. >7d stale = Edward flags it. Refresh in the same session you ship code.',
      ],
    },
    agents: AGENTS,
    integrations: INTEGRATIONS,
    references: REFERENCES,
    how_to_add_agent: HOW_TO_ADD_AGENT,
    how_to_pick_up_existing: HOW_TO_PICK_UP_EXISTING,
  })
}
