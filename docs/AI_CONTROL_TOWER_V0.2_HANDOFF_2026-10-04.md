# AI Control Tower v0.2 handoff — 2026-10-04

Canonical architecture: `ARCHITECTURE_CURRENT.md` → `AI_CONTROL_TOWER_ARCHITECTURE_V0.2.md`.

## Current baseline

Latest implementation commit:

```text
12a61bb build: use turbopack for production builds
```

Control-plane feature baseline:

```text
2f8e925 feat: add operational control tower learning signals
```

Branch: `feat/ai-ops-hub-v0.1`.

The AI Ops Hub working tree was clean after the implementation commit before this documentation refresh. No GitHub push was performed.

Product Factory remained authoritative and untouched:

```text
C:\Dev\product-factory
master
a181a3b5b1ca3a57a3d17cbc979e7a2fb1f90e88
working tree clean
```

No real Product Factory gate approval, App Store submission, paid API call, or Shufuro original Content OS regression mutation was performed.

## Implemented control-plane state

The following v0.2 capabilities are implemented in the current local baseline:

- FactoryDefinition / FactorySnapshot separation.
- Factory Registry with Product, Marketing, and Creative projections.
- Product Factory adapter preserving native Source of Truth.
- Dedicated Factory approval lifecycle:
  `OPEN → DECISION_RECORDED → APPLYING → APPLIED | FAILED | STALE`.
- Hold / revise safety and expected-revision compare-and-set behavior.
- Symbolic adapter commands only; no raw shell command execution from model/data output.
- Fresh native recheck before controlled Product gate execution.
- Shufuro Marketing REVIEW → READY fixture path with revision checks, rollback, and cross-process file lock.
- Experience Store with deterministic aggregation.
- Typed `learning_evidence` read/write flow.
- Deterministic candidate signals.
- Candidate readiness requires:
  - total evidence >= 5,
  - negative + mixed evidence >= 2,
  - unique sources >= 2,
  - no active candidate for the same subject.
- Candidate `evidence_needed` reflects all readiness conditions, not only total evidence count.
- Learning UI exposes deterministic signals, candidate signals, recent typed evidence, Improvement Queue, and read-only skillmem health.
- Home first operational surface exposes:
  - `NEEDS YOUR DECISION`
  - `RUNNING`
  - `BLOCKED`
  - `LEARNING`
- Factories UI separates:
  - Native stage
  - Process stage
  - Quality readiness
  - Freshness
  - Human gates
  - Blockers
  - Independent reviews
- Authenticated Control Tower smoke coverage for Home / Factories / Learning.
- skillmem remains read-only; auto-trust, hooks, MCP wiring, semantic embeddings, and optimizer auto-run remain OFF.
- Paid API default hard cap remains $0/day.

## Verification performed on current baseline

### Focused regression

Latest core regression run:

```text
5 test files passed
26 tests passed
```

Coverage includes:

- Factory approval state safety.
- stale expected revision rejection.
- single claim of DECISION_RECORDED → APPLYING.
- sync cannot infer APPLIED while command is applying.
- Product Factory legacy projection and App Review blocker.
- unsupported Product symbolic commands rejected without native writes.
- Shufuro REVIEW → READY isolated fixture.
- Shufuro concurrent writer lock behavior.
- typed Learning Evidence workspace isolation.
- deterministic candidate readiness thresholds.
- candidate remaining-evidence calculation.
- proxy/auth host and API-key gates.

### CSP / nonce

`src/lib/__tests__/csp.test.ts`:

```text
2 tests passed
```

Isolated Edge verification confirmed:

- CSP response nonce exists.
- DOM `script.nonce` exists.
- response nonce == DOM nonce.
- `getAttribute('nonce')` returns an empty string due browser nonce hiding behavior.
- inline theme bootstrap executed successfully.
- no console error on the isolated `/login` CSP smoke.

The React development `eval()` warning and nonce hydration warning are therefore treated as development-mode noise, not current production blockers. Do not weaken CSP with `unsafe-eval` merely to silence development warnings.

### Authenticated UI smoke

Using an isolated DB and temporary test account in Edge:

- Factory sync API: 200.
- Home operational surface rendered.
- `운영자 인증 중` residual count: 0.
- Factories core labels rendered:
  Native stage / Process stage / Quality readiness / Freshness / Human gates / Blockers / Independent reviews.
- Learning core labels rendered:
  Deterministic Signals / Candidate Signals / Improvement Queue / Skill Memory.

The Playwright Control Tower smoke config is included at:

`playwright.control-tower-smoke.config.ts`

and the current login-flow spec is discoverable as 6 tests.

### Production build / typecheck

Latest Windows verification:

```text
clean tsc --noEmit --extendedDiagnostics
PASS
Files: 3321
Memory used: ~1.33 GB
Total time: 69.89s

official cold pnpm build
PASS
engine: Next.js 16.2.11 Turbopack
total runtime: ~172s
static pages: 120/120
artifact:prepare: PASS
artifact:check: PASS
```

The previous Webpack path was measured as a build-performance bottleneck:
- compile remained active beyond 20 minutes,
- process working set approached ~4.7 GB,
- process private memory approached ~5.0 GB,
- no functional source error was observed before the run was stopped as a performance regression.

The production build script now uses Turbopack via commit `12a61bb`.

Turbopack emits 81 NFT whole-project tracing warnings, with a repeated Hermes route import trace. These warnings are currently classified as **non-blocking technical debt** because:
- the official build exits 0,
- TypeScript completes,
- 120/120 pages generate,
- the standalone artifact is prepared,
- the standalone boundary check reports `status: ok`.

Do not claim the warning is fixed. Do not revert to Webpack merely to avoid the warning without a measured alternative.

## Current observed Factory projections

These are projections captured through the adapter and are not promises of live freshness after this handoff.

### Product Factory — sonpo-tax-drill

- native stage: `TESTFLIGHT_UPLOADED`
- documented process stage: unknown / legacy
- quality: 4 / 9
- failed or pending quality items:
  - design_review
  - content_audit
  - dependency_audit
  - device_qa
  - release_redteam
- pending independent Claude reviews:
  - product_redteam
  - design_director
  - release_redteam
- `app_review_submit`: OPEN but blocked by quality/review prerequisites

Do not equate `TESTFLIGHT_UPLOADED` with release-ready.

### Shufuro

Marketing projection:
- EP001: RENDERED
- EP002: REVIEW

Creative projection:
- P001: RENDERED

Actual Shufuro original Content OS remains the native Source of Truth.

## Learning policy state

Current Learning level remains conservative:

- L0 Observe: active.
- L1 Detect: active through deterministic local aggregation.
- Typed evidence: active.
- Candidate readiness detection: active.
- L2 AI reflection: not auto-running.
- L3+ promotion: requires eval/evidence and policy gates.
- optimizer auto-run: OFF.
- GEPA / EvoAgentX / Agent Lightning auto-run: forbidden by current policy.
- independent Claude review is reserved for high-value/risky changes.

Self-improvement remains evidence-driven; agent self-opinion does not count as promotion evidence.

### Live Learning pipeline proof — 2026-10-04

A real Control Tower Factory refresh was executed against the normal local AI Ops database while keeping Product Factory and Shufuro native sources read-only.

Observed immediately after refresh:

```text
POST /api/factories: 200
snapshots returned: 3

experience_events: 4
learning_evidence: 23
candidate_signals: 23
candidate_ready: 0
improvement_candidates: 0

learning evidence:
- deterministic_check: 23
- positive: 12
- negative: 11
```

A second refresh of unchanged native revisions left the counts unchanged, confirming evidence idempotency.

The 23 evidence subjects currently each have one observation, so no L2 reflection threshold is met. Do not manufacture duplicate evidence to force readiness. Future evidence should come from real native revision changes and normal Factory refresh/use.

These counts are a runtime observation, not a permanent architecture constant.

## Remaining verification / implementation gates

1. **Live Product approval end-to-end gate**
   - The guarded path and isolated regression coverage exist.
   - No real Product Factory gate has been approved from the Control Tower.
   - Keep live Product gate mutation behind explicit human approval.

2. **Learning L2 reflection**
   - Typed evidence and deterministic candidate readiness now exist.
   - AI reflection remains intentionally disabled until enough real evidence exists.
   - Do not add automatic reflection merely because the schema/UI are ready.

3. **Hermes / NFT tracing debt**
   - The current production build is verified and passes.
   - 81 Turbopack NFT whole-project tracing warnings remain.
   - Treat this as performance/artifact hygiene debt, not as a current release blocker.
   - Any fix must preserve Hermes runtime behavior and standalone artifact integrity.

4. **Factory expansion**
   - Do not implement Growth / VOC / Revenue all at once.
   - Prove the contract on Product + Shufuro Marketing + Creative first.

## Recommended next development order

```text
1. Keep 12a61bb as the production-build-verified local baseline
2. Accumulate real typed evidence through normal Factory use
3. Add L2 batched reflection only after evidence threshold is meaningful
4. Add eval/rollback flow for the first real Improvement Candidate
5. Add typed cross-Factory feedback proposals
6. Investigate Hermes/NFT tracing debt without destabilizing the verified build
7. Expand to Growth / VOC / Revenue only when a real workflow demands it
```

Do not trade the current safety properties for faster autonomy.
