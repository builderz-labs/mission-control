# SOP — Task Decomposition

**Owner:** Sofia (PM / Delivery)  
**Purpose:** Convert ambiguous requests into execution-ready tasks with clear scope, ownership, dependencies, and Definition of Done (DoD).

## 1) Trigger Conditions
Use this SOP when a request is:
- larger than ~1 day of work,
- ambiguous, cross-functional, or multi-step,
- blocked by unknown dependencies,
- likely to involve handoffs between agents.

## 2) Intake Checklist (must pass before decomposition)
For each incoming request, capture:
1. **Outcome** (what must be true when done)
2. **Constraints** (deadline, risk, tech/legal limits)
3. **Stakeholder** (who validates success)
4. **Priority** (critical/high/medium/low)
5. **Risk level** (low/medium/high)

If any of the above is missing, create a **Clarification Task** first.

## 3) Decomposition Rules
Split work into tasks that are:
- **Atomic:** one clear deliverable
- **Ownerable:** exactly one owner
- **Testable:** has acceptance checks
- **Sequenced:** dependency order explicit
- **Small:** target 0.5–1.5 days each

Hard limits:
- Max 8 subtasks per parent task
- No subtask without DoD
- No task with more than one primary owner

## 4) Task Template (required fields)
Each task must include:
- **Title:** `[DOMAIN] Verb + Object` (e.g. `TECH: Add webhook retry jitter`)
- **Description:** context + expected output
- **Assigned to:** single owner
- **Status:** `todo` (or `in-progress` only when actively worked)
- **Priority:** aligned with intake
- **Dependencies:** upstream task IDs
- **DoD:** explicit completion criteria
- **Evidence:** links to PR/doc/test/artifact

## 5) Definition of Done (DoD) Standard
A task is “done” only if all are true:
- Deliverable exists and is linked
- Acceptance criteria are met
- Risks/edge cases noted
- Reviewer sign-off captured (if required by lane)
- Task comments summarize what changed

## 6) Dependency Mapping
Use these dependency types:
- **FS (Finish→Start):** most common; downstream starts after upstream ends
- **SS (Start→Start):** tasks can run in parallel after kickoff
- **Blocker:** unresolved external dependency

Escalate if:
- blocker unresolved > 1 heartbeat,
- dependency owner unknown,
- critical path slips without mitigation.

## 7) Quality Gate Before Execution
Before moving a decomposed set to execution:
- No ambiguity in titles/descriptions
- All tasks have owner + DoD
- Critical path identified
- Test/validation owner assigned (Elias lane)
- Security review flag added when auth/data/secrets touched (Tatiana lane)

## 8) Cadence & Board Hygiene
- Re-check active decompositions every heartbeat window
- Merge duplicates immediately
- Convert stale mega-tasks into smaller actionable tasks
- Move blocked tasks with explicit blocker notes (never silent stalls)

## 9) Escalation Matrix
- **Product ambiguity** → Alex
- **Planning conflict / resourcing** → Sofia
- **Technical implementation risk** → Henri
- **UX/content gaps** → Louise
- **Validation/test gaps** → Elias
- **Security/compliance risk** → Tatiana

## 10) Output Format for New Requests (copy/paste)

```md
## Decomposition Summary
- Parent Objective:
- Scope In:
- Scope Out:
- Critical Path:
- Risks:

## Tasks
1. [OWNER] TITLE
   - DoD:
   - Dependencies:
   - Evidence expected:

2. [OWNER] TITLE
   - DoD:
   - Dependencies:
   - Evidence expected:
```

---

**Revision policy:** update this SOP whenever repeated blockers, unclear handoffs, or recurring rework patterns are detected.
