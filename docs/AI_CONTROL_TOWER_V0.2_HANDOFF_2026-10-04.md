# AI Control Tower v0.2 handoff — 2026-10-04

Canonical architecture: `ARCHITECTURE_CURRENT.md` → `AI_CONTROL_TOWER_ARCHITECTURE_V0.2.md`.

## Current baseline

Latest implementation commit:

```text
2f8e925 feat: add operational control tower learning signals
```

Branch: `feat/ai-ops-hub-v0.1`.

The AI Ops Hub working tree was clean after this commit. No GitHub push was performed.

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

## Remaining verification / implementation gates

1. **Latest-commit production build gate**
   - A historical v0.2 production build passed before the latest learning/UI changes.
   - A full production build and full typecheck were not completed on `2f8e925` because the current Windows machine showed excessive resource use during those checks.
   - Do not report `2f8e925` as production-build-verified until that gate is rerun successfully.

2. **Live Product approval end-to-end gate**
   - The guarded path and isolated regression coverage exist.
   - No real Product Factory gate has been approved from the Control Tower.
   - Keep live Product gate mutation behind explicit human approval.

3. **Learning L2 reflection**
   - Typed evidence and deterministic candidate readiness now exist.
   - AI reflection remains intentionally disabled until enough real evidence exists.
   - Do not add automatic reflection merely because the schema/UI are ready.

4. **Factory expansion**
   - Do not implement Growth / VOC / Revenue all at once.
   - Prove the contract on Product + Shufuro Marketing + Creative first.

## Recommended next development order

```text
1. Keep 2f8e925 as the verified local control-plane baseline
2. Solve or isolate the latest-commit production build/typecheck resource issue
3. Accumulate real typed evidence through normal Factory use
4. Add L2 batched reflection only after evidence threshold is meaningful
5. Add cross-Factory feedback proposals
6. Expand to Growth / VOC / Revenue only when a real workflow demands it
```

Do not trade the current safety properties for faster autonomy.
