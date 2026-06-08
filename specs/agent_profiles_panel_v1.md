# Agent Profiles + Org Graph + Rooms — spec v1

**Status:** DESIGN (Gerda greenlit design-first, 8 Jun 2026). Build order: spec → Emergent mock → wire.
**Slots into EMERGENT_PROMPTS.md as §8** (extends §6 Agents panel + §7 Team panel — do NOT build a new top-level panel; enrich what's there).
**Owner split:** Atlas builds the data layer (ROADMAP → brain). Jose/Emergent design the visual. Claude wires.

---

## Why (Gerda, 8 Jun)

> "agents to have some bio there and we could press on them and see which phase they are at now in their building… what task they do already and automations? then which agent reports to which — later agent rooms for chatting and collaborating too."

Three asks, two of which are mostly **surfacing existing data**:
1. **Bio + clickable build phase** → already in each `~/<agent>/ROADMAP.md` (Role/Phase/Owner/Runtime) + MC registration.
2. **Tasks + automations they already do** → ROADMAP "What's shipped" + live crons/services.
3. **Who reports to whom** → `agent_human_pairings` (agent→human) exists; add **agent→agent** edges.
4. **Agent rooms (chat/collab)** → net-new, Phase C, deferred.

---

## Phase A — Enriched agent profile drawer

Extends the **existing** §6 per-agent drawer (`/api/epl/agents/[name]`). Click an agent → drawer now shows a real profile, not just raw `/api/stats`.

**Drawer regions (top → bottom):**
1. **Header** — emoji + name + role + `verb` (e.g. 🧭 Atlas · Chief of Staff · `orchestrate`) + owner-human chip + runtime chip (Python/TS · VPS systemd/PM2).
2. **Phase badge** — standardised enum (below), big and coloured. Sub-line = the free-text Phase line from ROADMAP (`SHIPPED + VALIDATED END-TO-END…`).
3. **Automations they run** — list of what the agent actually *does* unattended: `name · cadence · status`. e.g. Atlas → "Larry scan-triggers · every 6h · live", "Daily brief · Mon-Fri 08:00 BST · live". Status chip: live / shadow / planned.
4. **Last shipped** — one line + relative date.
5. **Next 3 actions** — checklist (from ROADMAP "Next 3").
6. **KPIs** — small stat grid (from ROADMAP KPIs / `/api/stats`).
7. **Reports to / works with** — paired humans (roles) + agent→agent edges (see Phase B) rendered as chips with `edge_type`.
8. **Blocked** — amber list if any (from ROADMAP "What's blocked").
9. **Footer actions** — "open ROADMAP" (GitHub) · "open in Slack" · (Phase C) "open room".

**Phase enum** (badge colour) — matches the fleet's real shadow-first lifecycle:
| phase | meaning | colour |
|---|---|---|
| `scaffold` | repo + spec, no live behaviour (e.g. Theo) | slate |
| `building` | code landing, not deployed | indigo |
| `shadow` | deployed, logging only, sends nothing (e.g. Hugo, Sofia auto-send) | amber |
| `live` | acting in production | emerald |
| `validated` | live + proven end-to-end (e.g. Atlas) | green + ✓ |

---

## Phase B — Org graph (reporting lines)

Gerda chose **full graph: agent→agent AND agent→human.**

**New brain table `agent_edges`:**
```
from_agent   text   -- agent slug (sofia/iris/atlas/…)
to_actor     text   -- agent slug OR person id (feb/arianne/…)
to_kind      text   -- 'agent' | 'human'
edge_type    text   -- 'reports_to' | 'orchestrated_by' | 'escalates_to' | 'hands_off_to' | 'feeds'
notes        text
updated_at   timestamptz
```
Human edges already live in `agent_human_pairings` (approver/escalation/input/…) — the graph view **unions** both sources; don't duplicate. Seed agent→agent edges from known wiring: Atlas `orchestrated_by`→all; Nathan `feeds`→Iris; Larry `hands_off_to`→Atlas (relay); Cleo `feeds`→James; Edward `feeds`→all (meta-scan).

**View:** a simple node-link graph (or indented tree if simpler in Emergent) — agents as cards, humans as smaller chips, edges labelled by `edge_type`. Click a node → opens that agent's drawer (Phase A) or person drawer (§7). Filter by edge_type. Keep it legible at 15 agents + ~16 people; this is not a full graph-viz lib — rounded cards + SVG/CSS lines, matching panel polish.

---

## Phase C — Agent rooms (chat + collaborate) — DEFERRED

The seed already exists: `handoffs` is agent→actor routing. Rooms = threaded spaces where agents + humans post.
- `rooms (id, topic, kind: 'agent'|'project'|'incident', created_at)`
- `room_messages (id, room_id, author_actor, author_kind, body, created_at, refs jsonb)`
- Agents post via an API (an extension of `app/brain.py`); humans post via MC UI. The §6 drawer already stubs `/chat?agent=<name>` — that becomes the room entry point.
- **Do not build yet** — land A + B, get them used, then design rooms with real traffic patterns. Flag scope before starting (this is the only true net-new build of the three).

---

## Data layer (Atlas — built independent of MC deploy)

**New brain table `agent_profiles`**, written by Atlas from each `ROADMAP.md` + MC `/api/agents` registration:
```
agent        text pk      -- slug
display_name text
role         text
verb         text
owner_human  text         -- person id
location     text         -- ~/<agent>/
runtime      text         -- 'python+slack' | 'typescript+pm2' | …
phase        text         -- enum above (parsed/normalised from ROADMAP Phase line)
phase_detail text         -- raw Phase line
last_shipped text
automations  jsonb        -- [{name, cadence, status}]
next_3       jsonb        -- [string]
kpis         jsonb        -- [{label, value}] or count
blocked      jsonb        -- [string]
roadmap_age_days int
updated_at   timestamptz
```
- **Writer:** `scripts/sync_agent_profiles.py` in Atlas — parses the 13 ROADMAP.md headers (Role/Verb/Owner/Runtime/Phase/Last shipped/What's shipped/Next 3/Blocked), normalises `phase`, upserts via the existing `app.brain` PostgREST client (on_conflict=agent). Cron alongside Edward's Friday ROADMAP-age scan.
- **Phase normalisation:** keyword map on the ROADMAP Phase line (`SHADOW`→shadow, `VALIDATED`→validated, `SCAFFOLD`→scaffold, else infer from "What's shipped" emptiness). Unmatched → `building` + flag for review (never silently mislabel).
- **Automations parsing:** start simple — pull bulleted "What's shipped" items that name a cadence (`every 6h`, `Mon-Fri 08:00`, `15-min cron`); everything else lists as a capability with status `live`. Refine later; don't over-engineer the parser.

**New read route `GET /api/epl/agents/[name]`** (extend existing): merge `/api/stats` (live) with `agent_profiles` (brain) so the drawer has both live counters and the structured profile. `GET /api/epl/org` returns `{agents, people, edges}` for the Phase B graph.

---

## Source-of-Truth map (Aggregator Principle — sign-off Gerda/Jose)

| Data | Canonical source | Reader |
|---|---|---|
| Agent bio/phase/automations/next-3/KPIs | **`~/<agent>/ROADMAP.md`** (updated in the same session anyone ships) | Atlas `sync_agent_profiles` → `agent_profiles` → `/api/epl/agents/[name]` |
| Agent↔human edges | Org Sheet Roster `paired_agents` → `agent_human_pairings` | `/api/epl/org` |
| Agent↔agent edges | `agent_edges` (seeded from known wiring; curated) | `/api/epl/org` |
| Live counters | each agent's `/api/stats` | drawer (merged) |

**Do NOT** invent a second bio store — ROADMAP.md stays canonical; `agent_profiles` is the agent-readable cache (same pattern as `people` ← Roster tab).

---

## What Emergent designs vs what's wired
- **Emergent designs:** the enriched drawer (Phase A) + the org graph view (Phase B). Match Properties/Agents/Team panels — rounded-2xl, slate borders, right-slide drawer; beat them on polish. No mockup yet — design fresh.
- **Claude/Atlas wires:** `agent_profiles` + `agent_edges` tables, the Atlas sync script, the merged `/api/epl/agents/[name]` + new `/api/epl/org` routes.
- **Reuse, don't rebuild:** §6 Agents panel + its drawer already exist — this enriches them. §7 Team panel already renders human pairings.

## Build order
1. **A data layer** — Atlas `sync_agent_profiles.py` → `agent_profiles` (parses 13 ROADMAPs). *Atlas-only, no MC dep.*
2. **A drawer** — Emergent enriches §6 drawer → wire merged route.
3. **B** — `agent_edges` table + seed + `/api/epl/org` + graph view.
4. **C rooms** — deferred; re-scope before building.

## Open decisions for Gerda/Jose
- Phase enum labels OK as-is (`scaffold/building/shadow/live/validated`)?
- Org graph as **node-link** or **indented tree** (tree is simpler/legible at this size)?
- Rooms: agents-only, or agents+humans in the same thread, when we get to C?
