# Jose Handoff — MC custom panels (Wk1 build)

**Owner:** Jose
**Goal:** turn 5 signed-off HTML mockups into production React inside the Mission Control fork at `~/mission-control/` → deploy to `mc.str-agents.com`.

**Time budget Wk1:** ~3 working days. Build Projects panel first (it's the Asana migration target for Wk2).

---

## What's already done (you don't need to redo)

- ✅ 5 HTML mockups signed off by Gerda — `~/mission-control/mockup/*.html` (2,683 lines total)
- ✅ Mockups copied to `~/mission-control/public/mockup/` so MC serves them at `/mockup/<name>-panel-preview.html`
- ✅ 5 React stub panels exist at `~/mission-control/src/components/panels/epl-{today,projects,properties,maintenance,decisions}-panel.tsx`
- ✅ Stubs render the mockup in an iframe + show a yellow dev banner pointing at the matching Emergent prompt
- ✅ Plugin file registers the 5 nav items + panel components: `~/mission-control/src/plugins/epl-panels.ts`
- ✅ Plugin bootstrap wired via side-effect import in `~/mission-control/src/app/[[...panel]]/page.tsx`
- ✅ 7 API endpoints return canonical mock JSON shaped exactly like the panels need:
  - `GET /api/epl/today`
  - `GET /api/epl/projects`
  - `GET /api/epl/properties`
  - `GET /api/epl/maintenance` (proxies real Hugo `/api/stats` when live, falls back to mock)
  - `GET /api/epl/decisions`
  - `GET /api/epl/agents` + `GET /api/epl/agents/[name]`
  - `GET /api/epl/atlas-brief?format=markdown` (morning brief composer — Atlas DM source)
- ✅ Each endpoint supports `?part=summary|kanban|heat|kpis|tiles|callouts|age-risk|by-category|stale-roadmaps` for partial fetches

---

## What you need to do

### 1. Verify the dev environment works

```bash
cd ~/mission-control
pnpm install
pnpm dev    # http://localhost:3000
```

Log in. Visit each new route in the left nav:
- `/today`         → 🌅 Today
- `/projects`      → 📋 Projects
- `/properties`    → 🏠 Properties
- `/maintenance`   → 🔧 Maintenance
- `/decisions`     → 🎯 Decisions
- `/agents-fleet`  → 🤖 Agents (fleet)

Each should show the HTML mockup in an iframe with a yellow dev banner at the top. The banner shows the API health (🟢 = endpoint returning data, 🔴 = endpoint broken, ⚪ = still loading).

If you don't see the new nav items, restart `pnpm dev` so the plugin self-registers.

### 2. Generate React with Emergent — Projects panel first

1. Open Emergent (or v0 / Bolt / Lovable — Gerda left the choice to you, recommend Emergent per the North Star).
2. Open `~/mission-control/EMERGENT_PROMPTS.md` and copy §2 verbatim.
3. Paste into Emergent. Drag the screenshot of `~/mission-control/mockup/projects-panel-preview.html` in as visual reference.
4. Iterate in Emergent — push the visuals **further** than the mockup. Gerda's brief: "Emergent can design even better, no?" — yes, please prove it. Polish, motion, dark mode, mobile.
5. Keep the JSON contract exactly as listed in §Contract. Your component fetches from `/api/epl/projects` and must read the fields by their existing names.

### 3. Drop the React in

Replace the body of `~/mission-control/src/components/panels/epl-projects-panel.tsx`:

```tsx
'use client'

// Replace the stub <EplPanelFrame /> with your generated component:
import { useEffect, useState } from 'react'

interface ProjectsData {
  generatedAt: string
  columns: {
    id: string
    label: string
    cards: { id: string; title: string; owner: string; tags: string[]; age: string }[]
  }[]
}

export function EplProjectsPanel() {
  const [data, setData] = useState<ProjectsData | null>(null)
  useEffect(() => {
    fetch('/api/epl/projects').then(r => r.json()).then(setData)
  }, [])
  if (!data) return <div>Loading…</div>
  // ... your Emergent-generated JSX here ...
}
```

Test locally — visit `/projects`, confirm cards render, drag-drop works, cross-nav buttons jump to the right panels.

### 4. Repeat for the other 4 panels

Order: Maintenance → Properties → Today → Decisions. Each Emergent run should take ~30-60 min (you've now done the workflow once).

### 5. Quality gate before push

```bash
cd ~/mission-control
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All four must pass. The MC repo's quality gate is `pnpm test:all` if you want the full set including e2e.

### 6. Deploy to Hetzner

The MC fork is on Hetzner VPS `204.168.227.30` (mc.str-agents.com). Follow `~/mission-control/HETZNER_PRODUCTION.md`. The short version:

```bash
ssh root@204.168.227.30
cd /opt/mission-control
git pull
pnpm install --frozen-lockfile
pnpm build
systemctl restart mission-control
```

Or `bash scripts/deploy-standalone.sh` if the standalone deploy script is set up.

---

## Aggregator Principle — DO NOT VIOLATE

Gerda's #1 rule. Every panel widget reads from ONE canonical source. No duplicate property dicts. No new hardcoded names.

- **Properties** → Property Aliases tab in OTA Registry sheet `1cknTr9J6BSkqpHIebo17oNQZJsp4v9CLmGZc-iL6SZA`
- **Occupancy** → PriceLabs (NOT BOOM — Feb confirmed PriceLabs is better for occ)
- **Revenue (P&L)** → James agent monthly P&L
- **Guest reviews** → Iris agent
- **Maintenance** → Hugo agent `/api/stats`
- **Cash flow** → Cleo agent
- **Agent status** → MC's own `mc-cli agents list --json`

If you need data from somewhere and there's no canonical source — STOP and ask Gerda before inventing one. Never create new local property name maps.

---

## Slack denylist — HARD RULE

When rendering assignees, owners, or @mentions in ANY panel:
- NEVER show user `U07FQ300EVB` — Hanna Olsson, left the company
- NEVER show user `U09MSN2EFK6` — Sheikh Abuzar duplicate Slack account (his canonical is `U0B00KX55V4` as Ali Staylio)

This is baked into the Maintenance API allowlist already, but check your other panels (Today, Projects, Decisions) don't accidentally re-introduce them.

---

## Cross-navigation matrix

| From → To       | How                                                        |
|------------------|------------------------------------------------------------|
| Today → any      | Top 3 Actions CTA buttons follow `deeplink` field          |
| Projects → Maintenance | Card with tag `maintenance` shows 🔧 button         |
| Properties → Maintenance | Drawer "Maintenance" tab loads filtered tickets   |
| Properties → Decisions | Drawer "Open in Decisions" button                  |
| Maintenance → Properties | Ticket property name links to flat detail          |
| Decisions → Projects | Row with category `Rapid` shows 📋 button             |
| Any → Agents     | Owner avatar → `/agents?name=<agentname>`                  |

URLs use Next.js App Router. `useRouter()` from `next/navigation` for navigation.

---

## Architecture recap (so you have the full picture)

```
┌────────────────────────────────────────────────────────────────┐
│  mc.str-agents.com  (canonical runtime — Hetzner 204.168.227.30) │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Next.js 16 + Tailwind + Zustand (existing MC core)        │   │
│  │ + 5 EPL custom panels (plugin) ← YOU BUILD THIS           │   │
│  │ + 44 existing OpenClaw panels                              │   │
│  │ + plugin registry (lib/plugins.ts)                         │   │
│  │ + SSE / WebSocket runtime                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          ↑                                       │
│                          │  /api/epl/*  (canonical aggregators) │
│                          ↑                                       │
│   ┌──────────────────────┴──────────────────────────────────┐   │
│   │  Agent fleet — speak via MCP or REST to MC               │   │
│   │  Sofia · Atlas · James · Aria · Larry · Hugo · Iris ...   │   │
│   └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘

         ┌────────────────────────┐
         │  Emergent (your tool)   │ ← generates React from prompts
         └────────────────────────┘
                    │
                    ▼  paste into src/components/panels/epl-*.tsx
```

---

## Questions / blockers — where to ask

- **Slack DM:** Gerda direct (use Gerda's Slack — she's at Workspace ID 1203637576513591)
- **Async questions about the codebase:** read `~/mission-control/CLAUDE.md` first, then ask in chat
- **Mockup ambiguity:** open the HTML mockup in browser, the file is the ground truth
- **API shape questions:** the `/api/epl/<name>/route.ts` file is the contract — don't change it without telling Gerda

---

## Done definition for Wk1

Projects panel:
- [ ] React component in `src/components/panels/epl-projects-panel.tsx` (no iframe, no stub banner)
- [ ] Fetches `/api/epl/projects`, renders 6-col Kanban from the mock data
- [ ] Drag-drop between columns (state can stay local for now)
- [ ] Card click → drawer with subtask list
- [ ] Cross-nav: maintenance-tagged cards have 🔧 button to `/maintenance`
- [ ] Mobile responsive
- [ ] Lint + typecheck + test green
- [ ] Deployed to mc.str-agents.com
- [ ] Loom video (~2 min) walking Gerda through it

Then we sunset Asana for the agent fleet (Wk2 target).
