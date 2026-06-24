# Buyer's Red-Flags Memo — Customer Support Platform Proposal

*A one-page checklist for evaluating / negotiating the Builderz Labs proposal. Each item is grounded in what the Mission Control codebase actually contains today.*

---

## The one question that matters

**"Which of these systems exist in Mission Control today, and which are built from scratch?"**

The proposal's price and timeline depend entirely on the claim that it "extends an existing platform" rather than building new. That claim is only ~20% true. The reusable parts are the *operational chassis* (auth, real-time, cost tracking, dashboard, Docker). The *customer support product itself* — channels, customer model, RAG, vision — does not exist yet.

---

## Red flags, with the underlying reality

| # | Claim in proposal | Reality | Ask the vendor |
|---|---|---|---|
| 1 | "Vector Database (pgvector)" / "Memory synchronization" | **No vector/embedding/RAG code exists.** Memory is SQLite keyword search. | "Show me the existing embedding/vector code." (There isn't any — it's net-new.) |
| 2 | "PostgreSQL setup, Redis integration, Queue workers" | App runs on **SQLite** with an **in-process scheduler**. No Postgres, no Redis, no queue. | "Is the data layer being re-platformed? Where is that priced?" (It isn't, in the original.) |
| 3 | Omnichannel (WhatsApp/Telegram/FB/IG/Discord/Slack/Email) in **40–60h** | Channels today are a **read-only proxy**. **No inbound message handling at all.** | "WhatsApp Business API alone is ~40–60h. How do 3 channels + unified inbox fit in 40–60h total?" |
| 4 | "Unified customer profile / recognition across channels" | **No customer entity exists.** The internal `messages` table is agent-to-agent. | "Where is the customer/conversation data model today?" (Net-new.) |
| 5 | RAG + multi-format ingestion (PDF/DOCX/CSV/Excel) in **50–60h** | **Zero ingestion, zero embeddings.** Built from scratch. | "This is greenfield RAG. Why is it priced like an integration?" |
| 6 | "Human handoff + Slack approval workflow" | Only a **binary approval gate** exists. No escalation logic, no live agent inbox, no Slack round-trip. | "Show me the existing escalation/Slack code." (Foundation is minimal.) |
| 7 | Vision AI (receipt **verification**, error-screenshot **interpretation**) | **Nothing exists.** And reliable receipt verification is research-grade, not a 30h feature. | "Is Vision assistive (human-confirmed) or autonomous? Autonomous verification is not a fixed-bid item." |
| 8 | "Multi-department" multi-tenant architecture | Everything lives in **one shared SQLite file** with a `workspace_id` column. | "What does true tenant isolation for customer PII require, and is it scoped?" |
| 9 | "Horizontal scaling / load balancing engine / no-downtime re-indexing" | Aspirational on a **SQLite monolith + in-process scheduler.** | "Are these deliverables or design goals? Show the scaling plan." |
| 10 | **No compliance scope** anywhere in the proposal | Customer support = PII over Meta/WhatsApp. GDPR + Meta data-handling rules apply. | "Where are data retention, GDPR, and Meta data-handling addressed?" |

---

## The estimate, in plain terms

- **Quoted:** 240–330 hours, ~$11,500 (≈ $35–48/hr blended).
- **Realistic:** **~540–880 hours** (2–3×), with risk concentrated in **channels, RAG, and the SQLite→Postgres re-platform**.
- **Interpretation:** Either a junior estimate that hasn't hit WhatsApp/RAG reality, or a **low anchor** where the true cost surfaces later as change orders. Either way, the number will move — better to move it now, in writing.

---

## Schedule risks the vendor does not control (so the 6–8 week MVP is at risk)

- **WhatsApp Business API:** Meta app review + business verification + message-template approval can take **weeks**.
- Any feature gated on Meta/Instagram/Facebook approval inherits that timeline.
- **Mitigation to demand:** a **Telegram-first MVP** (no business verification) that proves the full pipeline, with Meta verification started in parallel on day one.

---

## What's genuinely good (don't throw it out)

- **Strategy is sound:** reusing the ops chassis (auth, real-time, cost tracking, dashboard, Docker) really does save ~20% and de-risk deployment. That's a legitimate advantage.
- **Phase structure is logical** and the incremental-channel approach is right.
- The vendor **knows the foundation** (they built Mission Control) — that's real, just over-claimed in scope.

---

## Recommended negotiating positions

1. **Demand an honest reuse breakdown** — a line-by-line "exists today vs. net-new" table (the vendor can produce it; it's in their codebase).
2. **Re-baseline the three risk phases** (channels, RAG, data platform) to 2–3× and add an explicit **Phase 0: data re-platform** line item.
3. **Start with a true MVP:** ONE channel (Telegram), ONE department, PDF-only RAG, simple handoff. Validate the loop, *then* fund expansion.
4. **Convert fixed-bid to milestone-gated** on the high-risk phases (channels, RAG, vision) so cost tracks actual complexity instead of surfacing as surprise change orders.
5. **Add compliance to scope** (GDPR, PII retention, Meta data-handling) before any customer data flows.
6. **Put third-party schedule risk in writing** as client-owned with explicit mitigation.

---

**Net:** The strategy is reasonable; the *scope honesty and pricing* are not. Negotiate from the corrected baseline, start Telegram-first, and milestone-gate the hard parts.
