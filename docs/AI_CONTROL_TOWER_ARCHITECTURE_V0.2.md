# AI Control Tower Architecture v0.2 — Modular Factories + Low-Cost Learning

Date: 2026-10-04 (Asia/Tokyo)
Status: ARCHITECTURE FROZEN; IMPLEMENTATION BASELINE ACTIVE
Scope: AI Ops Hub control plane, Product Factory adapter, Shufuro Marketing/Creative proof, low-cost self-improvement
Implementation note: Product Factory remains untouched and authoritative. Implementation status is tracked against this frozen architecture rather than rewriting native Factory truth.

Current local baseline: `2f8e925 feat: add operational control tower learning signals` on `feat/ai-ops-hub-v0.1`.

Implemented and verified at the targeted-regression/UI-smoke level:
- Product/Marketing/Creative Factory projections and dedicated approval lifecycle.
- guarded symbolic command path with stale-revision/concurrency protections.
- Shufuro cross-process file lock and isolated REVIEW → READY regression path.
- Experience Store deterministic aggregation.
- typed `learning_evidence` storage/read flow and deterministic candidate signals.
- Home operational ordering: NEEDS YOUR DECISION → RUNNING → BLOCKED → LEARNING.
- Factories runtime axes: Native stage / Process stage / Quality readiness / Freshness / Human gates / Blockers / Independent reviews.
- authenticated Edge smoke for Home / Factories / Learning without residual auth boot stall.

Not yet claimed as live/production verified:
- a real Product Factory gate approval from the Control Tower,
- a full production build/typecheck of the latest `2f8e925` baseline,
- automatic L2 AI reflection or any higher-level self-promotion.

## 1. Executive decision

The Control Tower is a **portfolio control plane over independent Factory sources of truth**.

It is not:
- a universal workflow engine,
- a second copy of Product/Marketing state,
- an autonomous agent that rewrites its own rules without evidence,
- a system that calls expensive models after every task.

The target boundary is:

```text
AI CONTROL TOWER CORE
  ├─ Portfolio / Priorities
  ├─ Approval Inbox
  ├─ Factory Registry
  ├─ Snapshot Projection
  ├─ Command / Audit
  ├─ Cost & Usage Budget
  ├─ Experience Store
  ├─ Learning Engine
  ├─ Improvement Queue
  └─ Skill / Capability Registry
             │
             v
FACTORY CONTRACT + ADAPTER
             │
             v
NATIVE FACTORY SOURCE OF TRUTH
             │
             v
ChatGPT / Claude / Codex / Deterministic tools / Human / Real data
```

Core principle:

> **The Tower coordinates. Factories own domain truth. Learning proposes improvements. Evidence earns promotion.**

## 2. Approved architecture decisions

The following choices are accepted for v0.2:

1. **Contract location**
   - Compatibility manifests live in AI Ops Hub first.
   - Native Factory manifests may be added later.
   - Product Factory is not modified merely to satisfy the Hub.

2. **Factory state ownership**
   - Native Factory remains authoritative.
   - Hub stores verified projections/snapshots only.
   - A stale projection must be visibly stale.

3. **Approval storage**
   - Factory approvals use a dedicated approval lifecycle.
   - They are not ordinary auto-routable Mission Control tasks.
   - UI may visually merge task approvals and Factory approvals.

4. **Approval lifecycle**
   - `OPEN → DECISION_RECORDED → APPLYING → APPLIED | FAILED | STALE`
   - Human intent is not treated as effective approval until native state is refreshed and verified.

5. **Sync**
   - Polling + revision/content hash first.
   - Filesystem watchers/event buses are deferred until a second Factory proves the need.

6. **Commands**
   - Symbolic command IDs only.
   - Adapter owns executable paths and argument construction.
   - No raw command string from metadata, queue files, model output or Factory artifacts may be executed.

7. **Product stage display**
   - Native stage, documented process stage and quality readiness remain separate axes.
   - `TESTFLIGHT_UPLOADED` must never imply release-ready when checks/reviews are incomplete.

8. **Learning**
   - Passive evidence collection is always-on.
   - AI reflection is batched/conditional, not per-task.
   - Skills/prompts/workflows are not promoted by self-opinion.
   - External evidence and/or human confirmation is required.
   - Automatic optimizers are disabled by default.

## 3. Core ↔ Factory ↔ Adapter ↔ Worker architecture

```text
                    AI CONTROL TOWER
                           │
          ┌────────────────┼────────────────┐
          │                │                │
     Portfolio       Approval Inbox    Learning Plane
          │                │                │
          └────────────────┼────────────────┘
                           │
                    Factory Registry
                           │
       ┌────────────┬──────┼──────┬───────────┐
       │            │      │      │           │
    Product     Marketing Creative Growth   Revenue ...
       │            │      │
       v            v      v
  Factory Adapter  Factory Adapter ...
       │
       v
 Native Source of Truth
       │
       ├─ ChatGPT orchestration/research/synthesis
       ├─ Claude independent review/red-team
       ├─ Codex implementation/edit/test
       ├─ Deterministic tools
       ├─ Human decisions
       └─ Real-user/market/revenue evidence
```

Control Tower Core must not contain Product-specific stage names or Marketing-specific production rules.

## 4. Common Factory Contract v1

The common contract has two mandatory halves.

### 4.1 FactoryDefinition — static design

```json
{
  "contract_version": "1.0",
  "module": {
    "id": "product-factory",
    "name": "Product Factory",
    "purpose": "Evidence-to-revenue product lifecycle",
    "definition_version": "0.5",
    "state_authority": "external",
    "adapter_kind": "local-cli-files"
  },
  "capabilities": {
    "discover_instances": true,
    "read_snapshot": true,
    "request_approval": true,
    "execute_commands": true,
    "read_metrics": true,
    "emit_experience": true
  },
  "stages": [],
  "gates": [],
  "inputs": [],
  "artifacts": [],
  "outputs": [],
  "roles": [],
  "checks": [],
  "metrics": [],
  "risks": [],
  "dependencies": [],
  "commands": [],
  "cost_policy": {},
  "learning_policy": {}
}
```

### 4.2 FactorySnapshot — observed runtime state

```json
{
  "snapshot_version": "1.0",
  "instance_id": "product-factory:sonpo-tax-drill",
  "module_id": "product-factory",
  "observed_at": "ISO-8601",
  "source": {
    "authority": "C:\\Dev\\product-factory",
    "native_id": "sonpo-tax-drill",
    "revision": "git-or-content-hash",
    "adapter_version": "1"
  },
  "freshness": {
    "state": "fresh",
    "last_success_at": "ISO-8601",
    "last_error": null
  },
  "lifecycle": {
    "process_stage_id": null,
    "native_stage": "TESTFLIGHT_UPLOADED",
    "canonical_phase": "release",
    "status": "blocked"
  },
  "compatibility": {
    "native_version": "legacy",
    "contract_coverage": "partial",
    "warnings": []
  },
  "gates": [],
  "checks": [],
  "artifacts": [],
  "review_queues": [],
  "next_actions": [],
  "blockers": [],
  "risks": [],
  "metrics": [],
  "available_commands": []
}
```

### 4.3 Adapter interface

Every Factory adapter must implement the equivalent of:

```text
discoverInstances()
getDefinition()
getSnapshot(instance)
healthCheck(instance)

getApprovals(instance)
getArtifacts(instance)
getMetrics(instance)
getNextActions(instance)

execute(symbolicCommand, validatedArgs)
refresh(instance)
verifyPostcondition(actionResult)
```

The adapter is the only layer allowed to know how to call native CLIs or interpret native files.

## 5. Source-of-truth rules

| Concern | Authority |
|---|---|
| Product Factory stages/gates/checks/artifacts | Product Factory |
| Shufuro marketing state | Shufuro Marketing Content OS / future Marketing Factory |
| Creative asset state | Creative Factory |
| Revenue experiment state | Revenue Factory |
| Portfolio priority/allocation | Control Tower |
| Cross-Factory links | Control Tower |
| Approval decision audit | Control Tower |
| Effective native gate state | Native Factory |
| AI/worker output | Referenced Factory artifact store |
| Usage/cost rollup | Control Tower |
| Experience/learning history | Control Tower Learning Plane |
| Trusted/promoted operational rule | Skill Registry + human/evidence policy |

The Tower may cache native data but must preserve provenance and freshness.

## 6. Factory responsibility boundaries

### Product Factory
Owns:
- market signal to validated product,
- PRD/evals,
- prototype/implementation/QA,
- TestFlight/release,
- product metrics and kill/iterate/scale.

### Marketing Factory
Owns:
- audience/JTBD,
- positioning,
- channel strategy,
- campaign/content strategy,
- angles/hooks/messages/offers,
- creative brief,
- distribution plan,
- publish verification,
- performance diagnosis and learning.

Marketing does **not** own craft/rendering internals.

### Creative Factory
Owns:
- references,
- creative direction,
- script/storyboard/style frames,
- video/carousel/image production,
- deterministic media QA,
- independent creative QA,
- platform delivery packages.

Pipelines may include:
- Video: Remotion / FFmpeg / Qwen / platform audio
- Carousel: React/HTML/SVG/image renderer
- Static ad/image: image generation/template systems
- Landing visuals: Figma/web implementation

### Growth Factory
Owns:
- distribution experiments,
- ASO/SEO/CRO,
- acquisition,
- activation/onboarding,
- referral/lifecycle,
- channel scaling,
- experiment guardrails and rollback.

### Customer / VOC Factory
Owns:
- reviews/support/interviews/comments/churn evidence,
- normalization/dedupe/redaction,
- problem/JTBD/severity clustering,
- evidence-linked proposals to other Factories.

### Revenue Factory
Owns:
- pricing,
- packaging,
- paywall/offer,
- payment conversion,
- LTV/CAC/payback,
- churn/refund/margin,
- monetization experiments,
- scale/kill recommendations.

Only Product, Marketing and Creative are candidates for early implementation. Growth/VOC/Revenue stay definitions until real workflows justify them.

## 7. Marketing Factory candidate stages

These are a starting taxonomy, not a permanent global DSL:

```text
M00 Product / Market Context
M01 Audience Evidence
M02 JTBD / Psychology
M03 Positioning
M04 Channel Strategy
M05 Campaign / Content Strategy
M06 Creative Angles
M07 Hook / Message / Offer
M08 Creative Brief
M09 Distribution Plan
M10 Publish / Launch
M11 Measurement
M12 Diagnosis
M13 Learn / Kill / Iterate / Scale
```

Existing Shufuro Content OS maps naturally into a subset of these stages and should migrate through an adapter rather than be rewritten.

## 8. Creative Factory candidate stages

```text
C00 Creative Brief Intake
C01 Reference Research
C02 Direction Options
C03 Direction Review
C04 Script Lock
C05 Storyboard
C06 Style Frames
C07 Animatic
C08 Asset Production
C09 Motion / Edit
C10 Audio / Caption
C11 Deterministic QA
C12 Independent Creative Review
C13 Platform Adaptation
C14 Delivery
```

Risk/cost profile controls which stages are required. A low-risk 20-second social clip may use a short path; a flagship launch video may require the full direction/review path.


## 9. Learning Plane — self-improvement without runaway cost

The Learning Plane is cross-cutting. It is not another Factory.

```text
Factory execution
   ↓
Trace / output / error / metrics / review / cost
   ↓
Experience Store
   ↓
Deterministic aggregation
   ↓
Evidence threshold reached?
   ├─ No → store only
   └─ Yes
       ↓
   Reflection / Improvement Candidate
       ↓
   Historical Eval / Regression Check
       ↓
   Independent Review if risk requires
       ↓
   Human Promotion Gate if policy requires
       ↓
   Promote / Reject / Hold
       ↓
   Observe next real executions
       ↓
   Reinforce / Decay / Roll back
```

### 9.1 Non-negotiable rule

> **Self-improvement is not self-opinion.**

An agent saying its own approach worked does not strengthen or promote a rule.

Evidence classes that may strengthen a candidate include:
- deterministic test pass,
- accepted code diff,
- verified build,
- verified publish,
- real performance metric,
- real conversion/revenue outcome,
- human confirmation,
- independent reviewer acceptance.

### 9.2 Learning levels

| Level | Scope | Default policy |
|---|---|---|
| L0 Observe | trace/errors/metrics/provenance | automatic, no model call |
| L1 Detect | SQL/Python aggregation/pattern detection | automatic, local |
| L2 Reflect | batched AI analysis of multiple evidence points | conditional |
| L3 Improve | prompt/skill/routing candidate | eval required |
| L4 Workflow | stage/check/routing change | independent review + human gate |
| L5 System | Factory Contract/Core/security/policy change | branch/test/human approval required |

No learning action may silently escalate its own permission level.

## 10. Low-cost operating policy

The default mode is `economical`.

Goals:
- no mandatory new paid service,
- use existing Claude/Codex/ChatGPT entitlements where possible,
- use local deterministic tools before model calls,
- batch reflection,
- reserve independent review for high-value changes.

Recommended contract fragment:

```yaml
cost_policy:
  mode: economical

  paid_api:
    default_hard_cap_usd_per_day: 0
    require_explicit_enable: true

  local_compute:
    allow: true

  learning:
    passive_logging: always
    deterministic_analysis: always

    reflection:
      min_new_evidence: 5
      min_interval_hours: 24
      trigger_on_high_severity_failure: true

    independent_review:
      only_if:
        - workflow_change
        - business_rule_change
        - creative_direction_rule
        - release_policy_change
        - security_or_permission_change

    optimizer:
      auto_run: false
      require_explicit_experiment: true
```

The Hub must distinguish:
- real paid API cost,
- estimated API-equivalent cost,
- subscription-backed usage,
- local compute,
- unknown/unavailable quota.

It must not fabricate ChatGPT/Claude subscription quota percentages when those products do not expose them.

## 11. Experience Store

The Experience Store records what actually happened, with provenance.

Minimum event:

```json
{
  "experience_id": "uuid",
  "observed_at": "ISO-8601",
  "project_id": "shufuro",
  "factory_instance_id": "marketing:shufuro",
  "stage_id": "M11",
  "action_type": "publish_measurement",
  "worker": {
    "kind": "deterministic|chatgpt|claude|codex|human",
    "identity": "..."
  },
  "inputs": [],
  "artifact_refs": [],
  "checks": [],
  "metrics": [],
  "outcome": "success|failure|mixed",
  "cost": {
    "paid_usd": 0,
    "tokens": null,
    "local_compute_seconds": 0
  },
  "evidence_refs": [],
  "source_revision": "..."
}
```

Experience records are immutable observations. Interpretations belong in Improvement Candidates, not in the raw event.

## 12. Improvement Queue

An improvement is a proposal, never an automatic rewrite.

```json
{
  "candidate_id": "uuid",
  "scope": "skill|prompt|routing|check|workflow|policy",
  "target": "creative:shufuro-reel-hook",
  "status": "PROPOSED",
  "hypothesis": "Shorter first-frame copy improves completion",
  "evidence_refs": ["..."],
  "sample_size": 7,
  "confidence_label": "medium",
  "expected_effect": {
    "metric": "completion_rate",
    "direction": "increase"
  },
  "change_ref": null,
  "eval_plan": {},
  "review_policy": "claude+human",
  "promotion_state": "UNTESTED"
}
```

Lifecycle:

```text
PROPOSED
→ EVAL_READY
→ EVALUATING
→ REVIEW_REQUIRED
→ APPROVAL_REQUIRED
→ PROMOTED | REJECTED | HELD
→ OBSERVING
→ REINFORCED | ROLLED_BACK | DECAYING
```

## 13. Skill lifecycle and Capability Registry

Current AI Ops Hub Skills becomes a **Capability Registry**, not just a folder browser.

Desired metadata:

```text
name
version
source
license
security_status
provenance
trust_state
last_updated

scope:
  global
  factory
  project

assigned_to:
  factories[]
  projects[]
  workflows[]

usage:
  executions
  evidence_count
  confirmations
  failures
  last_used
  strength
  lifecycle_state

history:
  parent_version
  change_reason
  evidence_refs
  rollback_target
```

Suggested lifecycle:

```text
DISCOVERED
→ INSTALLED
→ UNTRUSTED
→ CANDIDATE
→ TRUSTED
→ ACTIVE
→ STALE
→ ARCHIVED
```

A learned skill cannot become `TRUSTED` merely because an agent wrote it.

## 14. skillmem integration strategy

Recommended integration: **Adapter first, not deep fork.**

skillmem is suitable because its current design provides:
- local SQLite storage,
- no API key/cloud requirement for memory read/write,
- Claude Code and Codex integration,
- learn/recall/reinforce/decay,
- provenance,
- owner trust,
- tamper-evident history,
- Windows scheduled maintenance,
- export to plain Markdown.

Control Tower should not replace skillmem's database or copy its internal tables.

Target boundary:

```text
Control Tower Skills / Learning UI
        │
        v
SkillMemoryAdapter
        │
        ├─ list/search/get
        ├─ learn candidate
        ├─ recall
        ├─ reinforce with evidence
        ├─ decay/status
        ├─ export
        └─ health/verify
        │
        v
skillmem local runtime + SQLite
```

### 14.1 Safety rules

- Do not auto-trust agent-written skills.
- Imported skill packs remain visibly untrusted until owner approval.
- Reinforcement requires evidence IDs from Control Tower or explicit human confirmation.
- Control Tower does not call `trust` silently.
- Skill memory failure must never block Product/Marketing/Creative execution.
- Do not install hooks into every agent until a compatibility test passes.
- Start with read-only inventory/health integration, then controlled learning.

### 14.2 Cost impact

skillmem memory operations are local and do not require model API calls. The optional semantic retrieval path is also local CPU. Model cost only appears when the surrounding agent is asked to reflect/summarize or act on recalled memory.

Therefore the default integration should keep:
- storage/recall/reinforcement local,
- reflection batched,
- semantic embeddings optional,
- optimizer loops off.

## 15. Optimizer Provider abstraction

Do not hardwire advanced self-optimization into Core.

```text
OptimizerProvider
  ├─ basic-reflection
  ├─ skillmem
  ├─ GEPA (future)
  ├─ EvoAgentX (future)
  └─ Agent Lightning (future / research)
```

Contract:

```text
supports(scope)
estimateCost(dataset, policy)
propose(evidenceBundle)
evaluate(candidate, evalSet)
report()
```

Default provider is deterministic aggregation + one batched reflection. Advanced optimizers require an explicit experiment and budget.

## 16. Marketing/Creative learning examples

### Marketing

Collect:
- angle,
- hook,
- message,
- offer,
- format,
- CTA,
- channel,
- posting time,
- reach,
- save/reach,
- share/reach,
- completion,
- profile visit,
- follow conversion,
- downstream activation/payment when available.

Example learning:

```text
5+ comparable posts
→ deterministic aggregation
→ pattern candidate
→ "Today action" CTA may improve saves
→ historical check
→ optional independent review
→ candidate rule
→ next 3 eligible posts observe
→ reinforce or reject
```

### Creative / Video

Collect:
- first-frame text density,
- scene duration,
- subtitle size,
- motion frequency,
- cut frequency,
- background density,
- audio/caption validation,
- export checks,
- platform retention/completion.

Deterministic QA remains separate from taste/creative judgement.

A rule such as "first-frame copy under N characters" must be stored as a candidate tied to actual evidence; it is not promoted from one post.

## 17. Cross-Factory feedback graph

Learning does not directly rewrite another Factory.

```json
{
  "feedback_id": "uuid",
  "from": "marketing:shufuro/M12",
  "to": "product:shufuro/input/positioning-feedback",
  "mode": "proposed",
  "signal": "high reach, low activation",
  "evidence_refs": [],
  "confidence_label": "medium",
  "requires_acceptance": true
}
```

Examples:
- low CTR/comments → Marketing positioning or Product context review,
- strong activation + weak payment → Revenue investigation,
- VOC cluster → proposed Product backlog input,
- strong creative performance + weak reach → Growth distribution investigation.

## 18. Minimal persistence model v0.2

Keep the original four Factory control tables:

1. `factory_instances`
2. `factory_snapshots`
3. `factory_approval_requests`
4. `factory_command_runs`

Add only three Learning tables initially:

5. `experience_events`
   - immutable observed execution/metric evidence.

6. `improvement_candidates`
   - hypotheses and lifecycle, with evidence refs.

7. `learning_evidence`
   - typed evidence linking tests/metrics/human confirmations to candidates or skills.

Do **not** yet add:
- a giant normalized stage schema,
- a custom vector database,
- RL training storage,
- a universal prompt registry,
- event sourcing for every filesystem mutation.

skillmem keeps its own SQLite DB when integrated.

## 19. Control Tower navigation impact

Target navigation remains simple:

```text
Home
Projects
Factories
  Product
  Marketing
  Creative
Development
Agents
Usage
Skills
Automations
Learning
Activity
Advanced
```

### Home first viewport

```text
NEEDS YOUR DECISION
- Factory gate approvals
- Improvement promotions
- Skill trust/update decisions
- Publish/deploy/release approvals

RUNNING
- Factory command jobs
- Agent work
- deterministic builds/renders/checks

BLOCKED
- native Factory blockers
- failed checks
- external login/CAPTCHA/2FA
- stale source projections

LEARNING
- new evidence since last reflection
- candidates ready for eval
- promoted rules under observation
```

Learning should not dominate Home over real work. Approval Inbox remains first.

## 20. Migration plan v0.2 — current implementation status

### Phase 0 — architecture/fixtures — COMPLETE
- Factory Contract/Snapshot v1 frozen.
- Approval lifecycle and symbolic command protocol frozen.
- Cost/learning policies defined.
- legacy Product Factory projection covered without false readiness claims.
- no native mutation required for representation.

### Phase 1 — Product Factory adapter/projection — COMPLETE
- Registry entry and instance discovery implemented.
- `status`, `quality-status`, `process-audit`, and `claude-queue` mapped.
- snapshot freshness/provenance persisted.
- UI projection separates native stage, process stage, and quality readiness.

### Phase 2 — dedicated Factory Approval Inbox — COMPLETE
- separate approval storage/API implemented.
- Factory approvals visually merge with operator attention without becoming generic tasks.
- scheduler does not treat Factory approvals as ordinary routable work.

### Phase 3 — one controlled Product write path — IMPLEMENTED / LIVE APPLY UNVERIFIED
- symbolic `approve-gate` path exists.
- exact gate, expected revision, human decision, native refresh, and postcondition verification are required.
- stale/concurrent decisions are rejected or marked stale.
- `APPLIED` is not inferred from button click or sync alone.
- no real Product Factory gate has been approved from the Control Tower yet.

### Phase 4 — Experience Store — COMPLETE BASELINE
- passive snapshot/decision observations implemented.
- deterministic aggregation implemented.
- zero-model-call operation verified by tests.

### Phase 5 — low-cost Learning Engine — PARTIAL
Implemented:
- typed `learning_evidence`.
- workspace isolation.
- deterministic candidate signals.
- threshold rules and Improvement Queue display.
- evidence counts exposed to Home/Learning UI.

Deferred by policy:
- automatic L2 AI reflection.
- automatic promotion.
- automatic optimizer execution.

### Phase 6 — skillmem compatibility adapter — PARTIAL / READ ONLY
- Windows-local skillmem install/DB health is surfaced read-only.
- auto-trust, hooks, MCP wiring, semantic embeddings, and reinforcement automation remain OFF.
- controlled learn/reinforce is deferred until external-evidence policy is proven in normal use.

### Phase 7 — Shufuro as second Factory proof — IMPLEMENTED BASELINE
- existing Content OS remains native Source of Truth.
- Marketing and Creative projections exist.
- isolated Marketing REVIEW → READY fixture path is covered.
- revision checks, rollback, and cross-process file lock are implemented.
- original Shufuro Content OS is not used as a destructive regression fixture.

### Phase 8 — cross-Factory feedback — NOT STARTED
Only after the current Product + Shufuro contract proves stable in normal use:
- add typed feedback proposals,
- evidence links,
- acceptance routing.

Growth/VOC/Revenue remain stubs until a real workflow requires them.

## 21. Overengineering guardrails

Do not:
- implement all Factories now,
- call Claude after every job,
- run GEPA/EvoAgentX automatically,
- make a universal workflow DSL,
- normalize every artifact into its own table,
- duplicate native Factory state,
- let learned rules become trusted automatically,
- let an optimizer change permissions/security/release policy,
- add paid API dependencies merely to make the system "self-improving",
- interpret one high-performing content item as a permanent rule.

The architecture test remains:

> Does the abstraction work for Product Factory and Shufuro without Core knowing either one's native stage names?

For Learning:

> Can the system explain exactly which external evidence caused a rule to be promoted?

If either answer is no, the abstraction is wrong.

## 22. Implementation acceptance criteria

v0.2 architecture is considered successfully implemented only when:

1. Product Factory remains untouched and authoritative.
2. Native stage, process stage and quality readiness are shown separately.
3. Stale/unreadable native state is visibly stale/blocked.
4. Factory approvals are not generic tasks.
5. No raw command string is executable from data/model output.
6. One Product gate approval can be applied and verified end-to-end before any broader write surface is enabled.
7. Experience Store can log work with zero model calls.
8. Learning reflection can be disabled without breaking Factory execution.
9. A learned skill/prompt cannot promote itself without evidence.
10. Cost policy can block optional model/optimizer calls.
11. Skills UI can distinguish installed/trusted/candidate/stale state.
12. Shufuro can become the second Factory implementation without Product-specific Core branches.
13. Marketing and Creative can be separated while preserving the existing Shufuro Content OS during migration.
14. A promoted improvement has an evidence trail and rollback target.

Current acceptance snapshot at `2f8e925`:
- Criteria 1–5, 7–8, and 12–13 are implemented at the current targeted-regression/control-plane level.
- Criteria 9–10 are enforced as conservative policy/default behavior, but a real learned-rule promotion and optional-model budget-block flow have not yet been exercised end-to-end.
- Criterion 11 remains **partial**: skillmem health/read-only integration exists, but full installed/trusted/candidate/stale lifecycle presentation is not implemented yet.
- Criterion 6 remains **live-unverified** because no real Product Factory gate has been applied from the Control Tower.
- Criterion 14 remains **not yet demonstrated with a real promoted improvement** because L2+ promotion is intentionally not auto-running.
- The latest baseline still requires a successful full production build/typecheck before it can be called production-build-verified.

## 23. Immediate implementation order

The original v0.2 foundation through Product/Marketing/Creative projection and deterministic Learning is now present in the local baseline.

The next code work is deliberately narrow:

```text
1. Keep 2f8e925 as the stable local control-plane baseline
2. Isolate/fix latest-commit production build + typecheck resource behavior
3. Accumulate real typed evidence through normal Factory use
4. Add L2 batched reflection only when evidence thresholds become meaningful
5. Add eval/rollback flow for the first real Improvement Candidate
6. Add typed cross-Factory feedback proposals
7. Prove a real guarded Product approval only with explicit human approval
8. Expand Growth / VOC / Revenue only when a real workflow requires it
```

Do not begin with optimizer integration, automatic reflection, or broad new Factory implementation.

## 24. External integration notes

Verified candidate:
- skillmem: local SQLite, Claude Code/Codex support, evidence-based reinforce/decay, provenance/trust, Apache-2.0. Treat as an optional memory adapter, not the Control Tower source of truth.
- OpenAI's Codex workflow guidance reinforces the same operational principle: improvements should be evidence-backed, tested, reviewed, and only implemented after approval rather than self-modified blindly.

These projects inform the design. Their internal data models do not become Control Tower contracts.

## Final architecture decision

**AI Ops Hub v0.2 = Portfolio Control Plane + Modular Factory Registry + Verified Approvals + Low-Cost Learning Plane.**

The self-improvement mechanism is intentionally conservative:
- observe everything cheaply,
- detect patterns locally,
- batch expensive judgement,
- require evidence,
- review high-risk changes independently,
- keep humans at irreversible gates,
- promote gradually,
- monitor and roll back.

This preserves the user's goal: a one-person AI company operating system that improves over time without turning every task into an expensive autonomous-agent loop.
