# AI Multi-Channel Customer Support Platform — Revised Proposal

**Prepared by Builderz Labs**
**Status:** Draft v2 (honest re-baseline)

---

## 1. Executive Summary

Builderz Labs maintains **Mission Control**, an open-source AI agent orchestration platform. It provides a production-grade *operational chassis*: authentication and role-based access control, real-time event streaming, cost/token tracking, task dispatch, an agent registry, and a Docker-based deployment story.

We propose building a dedicated **omnichannel customer support platform** that **reuses Mission Control's operational chassis** and adds the support-specific systems on top: inbound channel gateways, a customer conversation model, a retrieval-augmented knowledge base, and human escalation workflows.

**What this reuse actually buys you (≈20% of the build, the lowest-risk part):**

- Authentication, RBAC, and multi-workspace isolation — *built, solid*
- Real-time updates (SSE + WebSocket) — *built, solid*
- Cost and token-usage tracking per agent/task — *built, solid*
- Task dispatch plumbing and dashboard shell — *built, solid*
- Docker / standalone deployment — *built, solid*

**What is genuinely new work (≈80% of the build, where the cost and risk live):**

- Inbound messaging gateways (WhatsApp, Telegram, etc.) — *none today*
- Customer identity + cross-channel conversation model — *none today*
- RAG knowledge base: document ingestion, embeddings, vector search — *none today*
- Vision AI (receipts, screenshots) — *none today*
- Human handoff inbox + Slack approval round-trip — *only a basic binary approval gate today*
- Data re-platform from SQLite to PostgreSQL + pgvector + a queue — *Mission Control runs on SQLite with an in-process scheduler today*

This revised proposal corrects the original's framing (which described the support-specific systems as already present), re-baselines the hours on the three high-risk workstreams, and proposes a **Telegram-first MVP** to prove the loop before scaling channels.

---

## 2. Honest Foundation Audit

The following reflects what the Mission Control codebase implements **today**, verified against source.

| Capability | Reality today | Reusable for support platform? |
|---|---|---|
| Agent registry / orchestration | Orchestrates **external** AI agents (e.g. Claude Code) over MCP — a back-office control plane | **Partially** — the model is "internal worker agents," not customer-facing chatbots. Useful plumbing, wrong shape for end users. |
| SOUL personality system | Per-agent **markdown text** with placeholder substitution | **Partially** — good for system-prompt management; not a structured behavior engine |
| Memory | Filesystem knowledge graph + SQLite **full-text (FTS5) keyword** search | **Partially** — no semantic/vector retrieval. RAG is net-new. |
| Database | **SQLite** (better-sqlite3), single file | Re-platform required for Postgres + pgvector |
| Redis / queues | **None** — task distribution is HTTP polling + in-process scheduler | Net-new |
| Channels / messaging | Read-only **proxy** to an external gateway; **no inbound message handling** | Net-new |
| Customer model | **None** — internal `messages` table is agent-to-agent | Net-new |
| Knowledge ingestion (PDF/DOCX/CSV/Excel) | **None** | Net-new |
| Vision AI | **None** | Net-new |
| Human handoff / approval | Basic **binary** approval gate (`quality_reviews`); no escalation logic, no live agent inbox | Partial foundation only |
| Real-time (SSE + WebSocket) | **Solid** | **Yes** ✅ |
| Auth / RBAC / workspaces | **Solid** (admin/operator/viewer, API keys, sessions) | **Yes** ✅ |
| Cost / token tracking | **Solid** (`token_usage` with `cost_usd`) | **Yes** ✅ |
| Task management / cron | **Solid** | **Yes** ✅ |

**Bottom line:** Mission Control is a strong *operations chassis* to build on. It is **not** a customer support platform with channels and RAG that merely needs "configuring." The honest reuse is the chassis; the support product is new.

---

## 3. Architecture (Target State)

```
Customer Channels (Telegram → WhatsApp → …)
        │
        ▼
 Inbound Gateway + Webhook Layer        ← NEW
        │
        ▼
 Customer Identity + Conversation Store  ← NEW (Postgres)
        │
        ▼
 Intent Classification + Department Router ← NEW
        │
        ▼
 AI Agent Pool (LLM chatbots)           ← NEW behavior layer over MC agents
        │
        ▼
 RAG Knowledge Base (pgvector)          ← NEW
        │
        ▼
 Human Escalation + Slack Approval      ← extends MC approval gate
        │
        ▼
 Response Delivery (back to channel)    ← NEW

   ── reused from Mission Control ──
   Auth/RBAC · Real-time (SSE/WS) · Cost tracking · Dashboard shell · Docker
```

**Data layer decision (must be made up front):** Mission Control is SQLite today. A customer-support SaaS with vector search and queue workers needs PostgreSQL + pgvector + a queue (Redis or pg-based). Two options:

- **Option A — Re-platform** Mission Control's data layer to Postgres. Cleaner long-term, single source of truth, but touches the existing 50 migrations, auth, and multi-tenancy. Larger upfront cost.
- **Option B — Parallel stack:** keep SQLite for the ops chassis, add Postgres+pgvector+queue alongside for the support data. Faster to start, but two data stores to operate and keep consistent.

This is a real cost either way and is **scoped explicitly below** (it was absent from the original proposal).

---

## 4. Re-Baselined Phases

Hours reflect the support-specific work being **new**, not configured. Ranges are wide where third-party/research risk is high.

### Phase 0 — Data Platform & Foundation *(NEW — was missing)*
Postgres + pgvector provisioning, queue infrastructure, decision on re-platform vs. parallel stack, customer + conversation schema, migration strategy, observability/logging baseline, Docker environments.
**Estimate: 50–80h**

### Phase 1 — Core Platform & Multi-Tenant Hardening
Reuse MC auth/RBAC; extend to true tenant isolation for customer data; company/department config; customer identity system; API foundation for channels.
**Estimate: 40–60h** *(original: 30–40h — underscoped for real tenant isolation)*

### Phase 2 — Omnichannel Integration (Telegram first, then WhatsApp + Messenger)
Inbound webhook layer, channel abstraction, unified inbox, customer history sync. **Telegram** (easiest: no business verification), then **WhatsApp Business API** (Meta app review, template approval, 24-hour window rules, media), then **Messenger**.
**Estimate: 120–200h** *(original: 40–60h — WhatsApp alone is routinely 40–60h)*

### Phase 3 — RAG Knowledge Base & Routing *(built from zero)*
Multi-format ingestion (PDF/DOCX/CSV/Excel), chunking, embedding generation, pgvector storage, semantic retrieval, 3-tier KB hierarchy (company/department/agent), dynamic re-indexing, intent classification, department routing, agent load balancing.
**Estimate: 150–250h** *(original: 50–60h — no vector/RAG exists today)*

### Phase 4 — Human Handoff & Approval Workflows
Live human-agent inbox/dashboard, conversation claiming, internal notes, confidence-threshold + customer-request escalation, **Slack approval round-trip** (request → context → human reply → AI post-process → deliver), AI-assisted human replies (tone/translation/compliance), audit logging.
**Estimate: 60–90h** *(original: 40–60h)*

### Phase 5 — Customer Memory & Personalization
Unified customer profile, cross-channel identity mapping, persistent conversation memory, brand/business recognition, preference retention.
**Estimate: 40–60h** *(original: 30–40h)*

### Phase 6 — Vision AI *(net-new; receipt/error interpretation is research-grade)*
Vision model integration for screenshot analysis, receipt verification, product images. **Scope carefully** — "describe the image" is bounded; "reliably verify a payment receipt" is not.
**Estimate: 40–70h** *(original: 30–40h)*

### Phase 7 — Production Deployment, Compliance & QA
VPS, Docker Compose, reverse proxy, SSL, env management, queue workers, health monitoring, backups, load/E2E/UAT testing, **PII/data-retention & GDPR/Meta data-handling review** *(absent from original)*, documentation.
**Estimate: 40–70h** *(original: 20–30h)*

---

## 5. Re-Baselined Summary

| Phase | Original hrs | Revised hrs |
|---|---|---|
| 0. Data platform & foundation | — (missing) | 50–80 |
| 1. Core platform & tenancy | 30–40 | 40–60 |
| 2. Omnichannel | 40–60 | 120–200 |
| 3. RAG knowledge base | 50–60 | 150–250 |
| 4. Human handoff | 40–60 | 60–90 |
| 5. Customer memory | 30–40 | 40–60 |
| 6. Vision AI | 30–40 | 40–70 |
| 7. Deployment, compliance & QA | 20–30 | 40–70 |
| **Total** | **240–330** | **540–880** |

**Realistic total: ~540–880 hours** — roughly **2–3× the original 240–330h**, with variance concentrated in channels, RAG, and the data re-platform.

> Pricing is intentionally left for the client conversation. At the original blended rate the project is materially underpriced; the rate or the scope (or both) needs to move. We recommend pricing the chassis-reuse savings as a **discount on a realistic baseline**, not as a low absolute number that surfaces later as change orders.

---

## 6. Recommended MVP — Telegram-First, One Department

The original "MVP" (3 channels + KBs + memory + handoff + Slack + VPS in 6–8 weeks) is itself overscoped. A *true* MVP proves the end-to-end loop with the least third-party risk:

**In scope:**
- **One channel: Telegram** (no Meta business verification, no template approval — fastest path to a working loop)
- **One department** (e.g. Support)
- **Basic RAG** over PDFs only (defer Excel/CSV/DOCX)
- **Simple human handoff** (customer-request + low-confidence → human inbox; defer Slack round-trip to v2)
- Customer identity + conversation history for the one channel
- Reuse MC auth, real-time, cost tracking, dashboard, Docker
- VPS deployment with SSL + backups

**Explicitly deferred to post-MVP:** WhatsApp, Messenger, Instagram, Discord, Slack approval workflow, Vision AI, multi-department routing, load balancing, non-PDF ingestion.

**Why Telegram first:** WhatsApp Business API requires Meta app review and template approval that can take **weeks** and are outside our control. Telegram lets us ship and validate the entire pipeline (ingest → identify → route → RAG → respond → escalate) in days, then add WhatsApp as a known-quantity second channel.

**MVP estimate: ~160–240h.**

---

## 7. Key Risks (owned & flagged)

| Risk | Owner | Mitigation |
|---|---|---|
| WhatsApp/Meta app review & template approval delays | **Client** (account + business verification) | Telegram-first MVP; start Meta verification in parallel on day 1 |
| Data re-platform (SQLite → Postgres) scope | Builderz | Decide Option A vs. B in Phase 0 before committing later phases |
| RAG quality / hallucination on customer answers | Builderz | Confidence thresholds + human handoff as the safety net; eval harness |
| PII / GDPR / Meta data-handling compliance | Shared | Compliance review in Phase 7; data-retention policy agreed up front |
| Receipt/error-screenshot "verification" reliability | Builderz | Scope Vision as assistive, human-confirmed — not autonomous verification |

---

## 8. Why This Framing Is Stronger

The original proposal's "we're just extending an existing platform" pitch is appealing but invites a hard fall the moment WhatsApp review and RAG land — at which point the client feels misled and the budget blows out via change orders.

This revised framing is **honest and still compelling**: we genuinely save the client ~20% (the chassis) and de-risk deployment, while pricing the real 80% truthfully. That builds trust, survives contact with reality, and protects the relationship for the incremental channel/feature expansion that follows.
