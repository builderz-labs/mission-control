# Killzone Dashboard — Design V1

**Status:** Approved 2026-04-24, awaiting P0 implementation
**Owner:** Ross Hickey (CTO), Claude (engineering)
**Replaces:** Generic "ICT Dashboard" naming, ad-hoc proposal handling, version drift across components

---

## Naming

The dashboard is **Killzone**. The Discord bot remains **Captain Hook**.

| Surface | Name |
|---|---|
| Web app | Killzone |
| Subdomain | `killzone.ictwealthbuilding.com` (replaces `dashboard.`, leave `dashboard.` redirecting for 90 days) |
| Repo dir | `dashboard/` (no rename — internal) |
| Page title | `Killzone — ICT Trading Operations` |
| Footer | `Killzone v{X.Y.Z} — © ICT Wealth Building` |

`pulse.ictwealthbuilding.com` (currently 404) will be removed from the tunnel; do not revive.

---

## Pages

| Route | Purpose | Auth |
|---|---|---|
| `/` | Overview — equity, today's signals, system health | session |
| `/scanner` | Live signal feed, condition breakdowns | session |
| `/trades` | Trade ledger (paper + live) | session, user-scoped |
| `/proposals` | **NEW** — proposal queue, recommendations, approve/reject, multi-user roadmap | session, Ross-only writes |
| `/settings` | **NEW (P2)** — per-user sliders for tunable trading params | session, user-scoped |
| `/system` | Service health, cron status, scanner version | session |

---

## 1. Proposal Tracker (`/proposals`)

### Flow

```
Discord user runs /propose
  ↓
Captain Hook writes to bot.db.proposals (status=submitted)
  ↓
Captain Hook fires webhook → POST killzone-api/internal/proposal-received
  ↓
Background worker runs the 5-step assessment checklist:
    1. ICT Wiki check (grep concepts in /Obsidian/_LLM-Wiki/ICT-Wiki/)
    2. Scanner code check (grep refs in trading/scanners/)
    3. Trading DB data check (sqlite query for evidence)
    4. Proposal dependency check (any blockers in queue?)
    5. Recommend APPROVE / REJECT / MODIFY with reasoning
  ↓
Worker writes claude_recommendation, claude_reasoning, claude_assessed_at back to row
  ↓
Killzone /proposals page renders new card (WS push or 30s poll)
  ↓
Ross hits ✅ Approve / ❌ Reject / 📝 Send Back
  ↓
On Approve: status=approved, Captain Hook posts back to #ict-bot-alerts
            ("Proposal #N approved — queued for implementation"),
            row added to implementation_queue view
On Reject: status=rejected, Captain Hook posts reasoning back
On Send Back: status=needs_revision, submitter gets DM
```

### Schema additions (`bot.db.proposals`)

```sql
ALTER TABLE proposals ADD COLUMN claude_recommendation TEXT;     -- APPROVE|REJECT|MODIFY
ALTER TABLE proposals ADD COLUMN claude_reasoning TEXT;          -- markdown
ALTER TABLE proposals ADD COLUMN claude_assessed_at TIMESTAMP;
ALTER TABLE proposals ADD COLUMN ross_decision TEXT;             -- APPROVED|REJECTED|REVISE
ALTER TABLE proposals ADD COLUMN ross_decided_at TIMESTAMP;
ALTER TABLE proposals ADD COLUMN ross_notes TEXT;                -- optional
ALTER TABLE proposals ADD COLUMN implementation_status TEXT;     -- queued|in_progress|shipped|deferred
ALTER TABLE proposals ADD COLUMN implementation_pr TEXT;         -- GitHub PR URL when shipped
ALTER TABLE proposals ADD COLUMN shipped_in_version TEXT;        -- semver tag when shipped
```

### API endpoints (FastAPI, on `api.ictwealthbuilding.com`)

```
GET  /api/proposals              — list (filterable: ?status=pending|approved|rejected|all)
GET  /api/proposals/{id}         — detail
POST /api/proposals/{id}/decide  — body: {decision: APPROVED|REJECTED|REVISE, notes?: str}
                                   — auth: Ross session only
POST /internal/proposal-received — Captain Hook webhook, triggers assessment
                                   — auth: shared HMAC secret in env
```

### UI sketch (proposals card)

```
┌─────────────────────────────────────────────────────────┐
│  #10 — gregredic — 2 hours ago             [PENDING]    │
│  "Add VWAP confluence to 1h scanner"                    │
│                                                         │
│  Proposal:                                              │
│  > VWAP rejection at session open is a strong reversal  │
│  > signal in NY kill zone. Want it as 6th condition.    │
│                                                         │
│  ┌─ Claude's Recommendation ─────────────────────────┐  │
│  │ MODIFY                                            │  │
│  │                                                   │  │
│  │ ICT wiki confirms VWAP as institutional level.    │  │
│  │ Scanner already tracks volume but not VWAP.       │  │
│  │ DB shows 14 NY-kz losses in last 30d — meaningful │  │
│  │ sample. Worth adding, but as confluence FEATURE   │  │
│  │ (boosts confidence) not 6th hard condition — we   │  │
│  │ already cap at 5/5 for clean grading.             │  │
│  │                                                   │  │
│  │ Dependencies: requires VWAP calc in shared/       │  │
│  │ indicators.py (1-2 hours).                        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  [✅ Approve]  [❌ Reject]  [📝 Send Back]              │
│  Notes: [_____________________________________]         │
└─────────────────────────────────────────────────────────┘
```

### Roadmap section (bottom of page)

A persistent section below the queue showing the **multi-user trading roadmap** (P0-P5 below). Renders from a static MDX file initially; later from `roadmap` DB table when we want to track ETAs.

---

## 2. Version Control — Single Source of Truth

### Root cause of current drift

Every component has its own hardcoded version string. `bot.py` alone has v3.0, v3.1, v3.3 in different spots. SESSION-STATE says scanner is v3.6. Dashboard footer says v3.1. Nobody knows what's deployed.

### Fix

**One file, three readers, one bump command.**

```
/VERSION                              # contents: "3.6.0\n" — the only place this number lives
/engine/version.py                    # reads VERSION at import, exposes __version__
/scripts/bump-version.sh patch|minor|major
                                       # 1. bumps /VERSION
                                       # 2. git commit -m "chore: bump version to X.Y.Z"
                                       # 3. git tag vX.Y.Z
                                       # 4. (optional) git push origin main --tags
```

### Consumers

```python
# bots/discord/bot.py
from engine.version import __version__
# ... use __version__ in system prompt, /version command, embed footers

# trading/scanners/ict_scanner.py
from engine.version import __version__
# ... append version to alert payload

# dashboard API
@app.get("/api/version")
def get_version():
    return {"version": __version__, "commit": _git_sha()}
```

```typescript
// dashboard frontend
useEffect(() => {
  fetch('/api/version').then(r => r.json()).then(setVersion)
}, [])
// renders in footer
```

### Versioning policy (semver)

- **MAJOR** — breaking schema change, breaking API change, anything users would notice as a different system
- **MINOR** — new scanner condition, new dashboard page, new bot command
- **PATCH** — bug fix, copy change, dependency bump

Starting version: **3.6.0** (matches current scanner per SESSION-STATE).

### Discipline

- Every PR that touches scanner / bot / dashboard runtime code MUST bump in the same commit. Add a CI check in P1 that fails if `git diff` touches those dirs without bumping VERSION.
- `/system` page on Killzone shows: app version, git SHA, build time, last deploy. No more guessing.

---

## 3. Multi-User Trading — Phased Plan

### Architecture decision: simulated paper, real live

**Single signal stream → simulated paper ledger per user → real broker for live.**

Rejected: per-user paper API accounts. Tradovate paper is $25/mo each ($75-100/mo for 4 users), Alpaca paper doesn't do futures, and per-user paper API adds onboarding friction (signup, key paste, OAuth) for zero benefit over simulation.

Embraced: when a signal fires, we write a `paper_trades` row per `(signal, user_id)` pair using each user's settings. Same fill price, same stop, same target — but filtered through THEIR confidence threshold, instrument allowlist, position size, R-multiple. This is deterministic math we already do; we just do it 4 times.

When a user goes live, their `live_trades` rows come from their actual broker fills (Tradovate today, Alpaca later). Paper ledger keeps running in parallel as the baseline reference.

### Tunable settings (sliders/dials on `/settings`)

| Setting | Type | Default (baseline) | Range |
|---|---|---|---|
| Position size mode | radio | % equity | % equity, fixed contracts, fixed $ |
| Position size value | slider | 1% | 0.25% – 5% |
| Min confidence | slider | 4/5 | 3/5, 4/5, 5/5 |
| Allowed timeframes | checkboxes | 15m + 1h | 15m, 1h |
| Allowed instruments | checkboxes | ES + NQ | ES, NQ, (futures expansion later) |
| Allowed kill zones | checkboxes | NY AM + NY PM | London, NY AM, NY PM, Asia |
| Stop ATR multiplier | slider | 1.0x | 0.5x – 2.0x |
| Target R-multiple | slider | 2R | 1R – 4R |
| Max concurrent positions | slider | 2 | 1 – 5 |
| Daily loss halt ($ or %) | input | -$300 / -3% | user choice |
| Trading hours (UTC) | range slider | 13:00 – 21:00 | 00:00 – 23:59 |

**Slider superpower (P2):** every slider move triggers a "what-if recompute" against historical signals — user sees their projected equity curve, win rate, max drawdown update in real time. This is way more compelling than waiting weeks for new paper trades.

### Schema (new table)

```sql
CREATE TABLE user_settings (
    user_id           TEXT PRIMARY KEY,        -- 'ross', 'greg', 'ryan', 'baseline'
    display_name      TEXT NOT NULL,
    position_mode     TEXT DEFAULT 'pct_equity',
    position_value    REAL DEFAULT 0.01,
    min_confidence    INTEGER DEFAULT 4,
    timeframes        TEXT DEFAULT '15m,1h',   -- csv
    instruments       TEXT DEFAULT 'ES,NQ',    -- csv
    kill_zones        TEXT DEFAULT 'NY_AM,NY_PM',
    stop_atr_mult     REAL DEFAULT 1.0,
    target_r_mult     REAL DEFAULT 2.0,
    max_positions     INTEGER DEFAULT 2,
    daily_halt_pct    REAL DEFAULT -0.03,
    hours_start_utc   INTEGER DEFAULT 13,
    hours_end_utc     INTEGER DEFAULT 21,
    is_baseline       BOOLEAN DEFAULT 0,        -- baseline row is read-only
    mode              TEXT DEFAULT 'paper',     -- paper | live
    broker            TEXT,                     -- tradovate | alpaca | null
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- baseline row is seeded on migration and protected from edits
INSERT INTO user_settings (user_id, display_name, is_baseline) VALUES ('baseline', 'Baseline', 1);
```

`paper_trades.account_id` already references this. `live_trades` (new table P3) will too.

### Phasing

| Phase | Scope | Ships | When |
|---|---|---|---|
| **P0** | Killzone rename, /VERSION file, version readers in bot+scanner+dashboard, `/proposals` page MVP (read-only, with Approve/Reject), proposal webhook from Captain Hook, schema migrations | Killzone footer with real version, proposals visible in browser instead of bot.db | This week |
| **P1** | Auth (session cookie + Ross-only RBAC for writes), proposal Approve/Reject buttons wired, proposal Discord echo-back, `user_settings` table + baseline seed, retroactive `paper_trades` tagging by user_id | Ross can approve from browser, all paper trades attributable to a user | Week of 2026-05-05 |
| **P2** | `/settings` page with sliders, what-if recomputation, simulated paper trades branch per user (Ross/Greg/Ryan), per-user equity curve | Greg + Ryan can see their own paper performance based on their tuning | Week of 2026-05-19 |
| **P3** | Multi-user dashboard views: PnL leaderboard, baseline-vs-live drift chart, per-user trade history, live trade ingest from agent fills (Ross's Tradovate first) | The "killer chart" — all 4 users plotted as lines on one equity curve, baseline as reference | Week of 2026-06-02 |
| **P4** | Onboarding: pairing token UI, broker connect wizard (Tradovate creds → OS keyring on user machine), settings tour, "go live" gate (must be paper-positive 30 days) | Greg/Ryan can self-serve onboard without me touching their box | Week of 2026-06-23 |
| **P5** | Subscription/billing layer (Stripe), tiered access | Defer until 5+ users actively want it | TBD |

### The killer chart (P3)

Single chart, x-axis = date, y-axis = equity. Four lines:
- **Baseline** (reference, gray dashed)
- **Ross** (color)
- **Greg** (color)
- **Ryan** (color)

Hovering on any line shows the active settings on that date. When a user changes settings, an annotation marker appears on their line. This is the data product — "did your tuning help or hurt vs the recommended baseline?"

---

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-24 | Dashboard named **Killzone** | ICT-native, short URL, clear separation from Captain Hook (the bot) |
| 2026-04-24 | Simulated paper, not per-user broker accounts | Free, instant onboarding, slider-replayable, no Tradovate $25/mo per user |
| 2026-04-24 | Single `/VERSION` file as semver source | Eliminates v3.0/v3.1/v3.3/v3.6 drift across components |
| 2026-04-24 | Proposal recommendations auto-generated by Claude before Ross sees them | Ross approves with full context, doesn't need to redo the 5-step checklist |
| 2026-04-24 | Paper-baseline row is read-only forever | Always have a reference benchmark; protects "what we recommend" from creep |
| 2026-04-24 | Live trading gate: 30 days paper-positive before user can go live | Prevents Greg/Ryan from blowing up their own accounts on bad tuning |

---

## Open Questions (deferred to P0 kickoff)

1. Tunnel: cut over to `killzone.ictwealthbuilding.com` immediately or wait until P1? Recommend wait, keep `dashboard.` working through P1 to avoid breaking bookmarks.
2. Captain Hook webhook auth: shared HMAC secret in `/opt/captain-hook/.env` and `/opt/ict-dashboard-backend/.env`, or mTLS? Recommend HMAC for simplicity.
3. Roadmap rendering: static MDX vs DB table? Recommend static MDX for P0, migrate to DB if/when ETAs need to update without redeploys.
4. CI version bump check: GitHub Action vs pre-commit hook? Recommend GitHub Action — pre-commit is bypassable.

---

**Next action:** P0 implementation kickoff — confirm with Ross and start with the `/VERSION` file + bump script (smallest, unblocks everything else).
