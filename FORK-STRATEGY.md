---
summary: "Fork strategy for builderz-labs/mission-control with clean Lionroot extensions"
read_when:
  - "Setting up mission-control fork"
  - "Adding Lionroot features to mission-control"
  - "Pulling upstream mission-control updates"
  - "Working on UI consolidation"
---

# Mission Control Fork Strategy

## Goal

Fork `builderz-labs/mission-control` and extend it with Lionroot-specific features
(guidance, loops, observatory, nightshift, etc.) while keeping a clean boundary so
upstream merges stay low-friction.

## Principles

1. **Upstream stays mergeable** — Lionroot code lives in clearly namespaced paths
2. **No upstream file edits when possible** — Use extension points, not patches
3. **Custom migrations are numbered high** — Upstream uses 001–099; we use 100+
4. **Feature flags over forks** — Prefer env-var toggling over code divergence
5. **Document every upstream touch** — If we must edit an upstream file, track it in `UPSTREAM-PATCHES.md`

---

## Repository Setup

```bash
# 1. Fork on GitHub: builderz-labs/mission-control → lionroot/mission-control
gh repo fork builderz-labs/mission-control --org lionroot --clone=false

# 2. Clone locally
git clone git@github.com:lionroot/mission-control.git ~/programming_projects/lionroot-openclaw/command-post/mission-control
cd ~/programming_projects/lionroot-openclaw/command-post/mission-control

# 3. Set up upstream tracking
git remote add upstream https://github.com/builderz-labs/mission-control.git
git fetch upstream

# 4. Create integration branch
git checkout -b lionroot/main
git push -u origin lionroot/main
```

### Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Mirror of upstream main (never commit here) |
| `lionroot/main` | Our default branch — upstream + Lionroot features |
| `lionroot/feature/*` | Feature branches for new Lionroot work |
| `upstream-sync/*` | Temporary branches for merging upstream changes |

### Upstream Sync Workflow

```bash
# Pull upstream changes
git fetch upstream
git checkout -b upstream-sync/$(date +%Y-%m-%d) upstream/main

# Merge into our branch
git checkout lionroot/main
git merge upstream-sync/$(date +%Y-%m-%d)

# Resolve conflicts (should be minimal if we follow the namespacing rules)
# Test, then push
git push origin lionroot/main
```

---

## Directory Convention — Where Lionroot Code Lives

### Custom panels

```
src/components/panels/lionroot/
  ├── GuidancePanel.tsx
  ├── LoopsPanel.tsx
  ├── ObservatoryPanel.tsx
  ├── NightshiftPanel.tsx
  ├── CalendarPanel.tsx
  └── UsageLedgerPanel.tsx
```

### Custom API routes

```
src/app/api/lionroot/
  ├── guidance/
  │   └── route.ts            # GET/PUT guidance files
  ├── loops/
  │   └── route.ts            # Zulip loop state
  ├── nightshift/
  │   └── route.ts            # Nightshift status
  ├── calendar/
  │   └── route.ts            # Calendar sync
  ├── neo4j/
  │   └── route.ts            # Knowledge graph queries
  ├── observatory/
  │   └── route.ts            # Session graph data
  └── usage/
      └── route.ts            # Multi-source token ledger
```

### Custom lib modules

```
src/lib/lionroot/
  ├── guidance.ts              # Guidance file reader/writer
  ├── zulip.ts                 # Zulip API client
  ├── nightshift.ts            # Nightshift state reader
  ├── neo4j.ts                 # Neo4j driver wrapper
  ├── calendar.ts              # Calendar sync logic
  ├── observatory.ts           # Session graph builder
  ├── usage-ledger.ts          # Multi-source cost aggregation
  └── migrations.ts            # Lionroot-specific DB migrations (100+)
```

### Custom types

```
src/types/lionroot.ts          # All Lionroot-specific TypeScript types
```

### Custom store slices

```
src/store/lionroot.ts          # Zustand slice for Lionroot state
```

---

## Integration Points (Minimal Upstream Touches)

These are the **only upstream files** we need to modify. Each change is small and
well-documented to minimize merge conflicts.

### 1. Nav Rail — Add LIONROOT group

**File**: `src/nav-rail.tsx`
**Change**: Append one nav group to the groups array

```typescript
// === LIONROOT EXTENSIONS (do not remove — managed by lionroot fork) ===
import { lionrootNavGroup } from './components/panels/lionroot/nav-config'
// Add to navGroups array:
...navGroups, lionrootNavGroup
```

Our nav config lives in our own file:
```
src/components/panels/lionroot/nav-config.ts
```

### 2. Content Router — Add panel cases

**File**: `src/page.tsx` (ContentRouter function)
**Change**: Import and add cases for Lionroot panels

```typescript
// === LIONROOT EXTENSIONS ===
import { LionrootContentRouter } from './components/panels/lionroot/router'

// In ContentRouter, before default case:
const lionrootPanel = LionrootContentRouter(activeTab)
if (lionrootPanel) return lionrootPanel
```

Our router lives in our own file:
```
src/components/panels/lionroot/router.tsx
```

### 3. Migration Runner — Load Lionroot migrations

**File**: `src/lib/migrations.ts`
**Change**: Import and append Lionroot migrations

```typescript
// === LIONROOT EXTENSIONS ===
import { lionrootMigrations } from './lionroot/migrations'
// Append to migrations array:
const allMigrations = [...migrations, ...lionrootMigrations]
```

### 4. Environment Variables

**File**: `.env.example`
**Change**: Add Lionroot-specific env vars

```env
# === LIONROOT EXTENSIONS ===
GUIDANCE_ROOT=          # Path to guidance markdown files
ZULIP_API_BASE_URL=     # Zulip server URL
ZULIP_BOT_EMAIL=        # Zulip bot email
ZULIP_BOT_API_KEY=      # Zulip bot API key
NEO4J_URI=              # Neo4j bolt URI
NEO4J_USER=             # Neo4j username
NEO4J_PASSWORD=         # Neo4j password
VAULT_ROOT=             # Path to Obsidian vault
NIGHTSHIFT_STATE_DIR=   # Path to Nightshift state
CLAWD_ROOT=             # Path to clawd directory
OPENCLAW_SESSIONS_DIR=  # Path to OpenClaw session data
CLAUDE_DATA_DIR=        # Path to Claude session data (complements MC's built-in scanner)
```

### Summary of Upstream Touches

| File | Change | Conflict Risk |
|------|--------|:---:|
| `src/nav-rail.tsx` | +2 lines (import + group) | Low |
| `src/page.tsx` | +3 lines (import + router call) | Low |
| `src/lib/migrations.ts` | +2 lines (import + spread) | Low |
| `.env.example` | +12 lines (env vars) | None |

Total: **~19 lines** of changes to upstream files.

---

## Feature Porting Plan

### Phase 1: Foundation (Week 1)

Set up the fork, deploy, verify upstream features work.

- [ ] Fork repo on GitHub
- [ ] Set up `lionroot/main` branch
- [ ] Create directory structure (`src/components/panels/lionroot/`, `src/app/api/lionroot/`, `src/lib/lionroot/`)
- [ ] Create `lionroot/nav-config.ts` and `lionroot/router.tsx` stubs
- [ ] Apply the 4 upstream file patches
- [ ] Create Dockerfile (production build, not dev mode)
- [ ] Add to `docker-compose.macpro.yml` (replace openclaw-studio)
- [ ] Deploy and verify all upstream features work
- [ ] Set up Tailscale Serve on :8446

### Phase 2: Guidance System (Week 2)

Port the 4-level guidance system from Command Post.

- [ ] `src/lib/lionroot/guidance.ts` — file reader/writer (port from `command-post/dashboard/app/api/guidance/route.ts`)
- [ ] `src/app/api/lionroot/guidance/route.ts` — REST API
- [ ] `src/components/panels/lionroot/GuidancePanel.tsx` — UI (port from `command-post/dashboard/app/command-post/guidance/page.tsx`)
- [ ] Mount guidance files volume in docker-compose
- [ ] Verify: guidance page shows 11/11 agents, 11/11 channels

### Phase 3: Loops + Zulip (Week 3)

Port Zulip integration for agent loop monitoring.

- [ ] `src/lib/lionroot/zulip.ts` — Zulip API client
- [ ] `src/app/api/lionroot/loops/route.ts` — Loop state API
- [ ] `src/components/panels/lionroot/LoopsPanel.tsx` — Loop dashboard
- [ ] Wire up agent loop streams from `agent-loop-streams.ts`

### Phase 4: Observatory + Nightshift (Week 4)

Port session visualization and activity monitoring.

- [ ] `src/lib/lionroot/observatory.ts` — Session graph builder
- [ ] `src/lib/lionroot/nightshift.ts` — State reader
- [ ] `src/app/api/lionroot/observatory/route.ts`
- [ ] `src/app/api/lionroot/nightshift/route.ts`
- [ ] Panel components
- [ ] Volume mounts for nightshift state

### Phase 5: Neo4j + Calendar + Usage (Week 5+)

Port remaining integrations.

- [ ] Neo4j knowledge graph queries
- [ ] Calendar sync
- [ ] Multi-source usage ledger (extend MC's built-in token tracking)

---

## Deployment

### Docker Compose Entry

```yaml
mission-control:
  build:
    context: ./mission-control
    dockerfile: Dockerfile
  image: lionroot-mission-control:latest
  container_name: lionroot-mission-control
  restart: unless-stopped
  network_mode: host
  environment:
    - NODE_ENV=production
    - PORT=3008
    - HOSTNAME=0.0.0.0
    - AUTH_USER=lionheart
    - AUTH_PASS=${MC_AUTH_PASS}
    - API_KEY=${GATEWAY_TOKEN}
    - OPENCLAW_HOME=/data/openclaw
    - OPENCLAW_GATEWAY_HOST=127.0.0.1
    - OPENCLAW_GATEWAY_PORT=18789
    - OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}
    - MC_CLAUDE_HOME=/data/claude-data
    - MC_ALLOWED_HOSTS=macpro.tail63777e.ts.net
    # Lionroot extensions
    - GUIDANCE_ROOT=/data/guidance
    - ZULIP_API_BASE_URL=${ZULIP_API_BASE_URL}
    - ZULIP_BOT_EMAIL=${ZULIP_BOT_EMAIL}
    - ZULIP_BOT_API_KEY=${ZULIP_BOT_API_KEY}
    - NEO4J_URI=bolt://100.86.108.86:7687
    - NEO4J_USER=neo4j
    - NEO4J_PASSWORD=lionroot-openclaw
    - VAULT_ROOT=/data/vault
    - NIGHTSHIFT_STATE_DIR=/data/nightshift
    - CLAWD_ROOT=/data/clawd
  volumes:
    - /opt/lionroot-command/guidance:/data/guidance:rw
    - /opt/lionroot-command/nightshift:/data/nightshift:ro
    - /opt/lionroot-openclaw-config:/data/openclaw:ro
    - /opt/lionroot-clawd:/data/clawd:ro
    - /opt/lionroot-vault:/data/vault:ro
    - /Users/lionheart/.claude:/data/claude-data:ro
    - mission-control-data:/app/.data
  healthcheck:
    test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:3008/api/status"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

### Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/lib/schema.sql ./src/lib/schema.sql

RUN mkdir -p .data && chown -R node:node .data
USER node
EXPOSE 3008
ENV PORT=3008
CMD ["pnpm", "start"]
```

---

## What Gets Retired

| Current Service | Replacement | Notes |
|----------------|-------------|-------|
| openclaw-studio (Docker, dev mode) | Mission Control | MC is production-grade, has more features |
| Command Post fleet page | MC agents panel | MC has better lifecycle management |
| Command Post cron page | MC cron panel | Similar capability, MC is more complete |
| Command Post usage page | MC tokens panel + Lionroot usage | MC adds Claude session scanning |

| Stays in Command Post | Why |
|-----------------------|-----|
| Guidance page | Ported to MC but CP remains as fallback during migration |
| Inbox | Unique to CP — port later if needed |
| Story Bible / Creative | Unique to CP |
| Family / Homeschool | Unique to CP |
| Physical / Rhythms | Unique to CP |

---

## Upstream Contribution Opportunities

Features we build that upstream might want:

- Guidance/SOUL system enhancements (they already have SOUL)
- Zulip integration (general messaging platform support)
- Multi-source usage ledger
- Neo4j knowledge graph panel

Contribute back by opening PRs from feature branches to upstream/main.
