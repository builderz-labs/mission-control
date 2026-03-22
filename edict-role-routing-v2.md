# Edict Role Routing v2

## Goal
Define a practical **role -> agent/model-family routing policy** for Mission Control's Edict workflow, assuming the currently available model families are primarily:
- **OpenAI**
- **Claude Code**

And with one explicit Jeffrey preference:
- the **dispatcher / rule-first fallback lane** should use **MiniMax 2.7** when a model is needed.

This document is intentionally about **routing policy**, not UI.

---

## Core Principle
Edict v1 already gives Mission Control:
- workflow stages
- transition guards
- project-level Edict mode
- Edict board semantics

Edict v2 should add:
- **role-aware agent/model routing**
- **family separation between execution and review**
- **deterministic fallback behavior**

The most important institutional rule is:

> **The model family that executes should not normally be the same family that deliberates/reviews.**

This preserves second-opinion behavior.

---

## Roles
Edict v2 uses the following conceptual roles:
- **Taizi** (太子) = intake / routing
- **Zhongshu** (中书) = planning / drafting
- **Menxia** (门下) = deliberation / approval / veto
- **Shangshu** (尚书) = dispatch / coordination
- **Liubu** (六部) = execution
- **Aegis** = post-execution quality review

These roles are routing semantics first. They do not require separate UI personas in v2.

---

## Recommended Default Routing
### 1. Taizi / Intake
**Default family:** OpenAI  
**Purpose:** classify, summarize, decide whether to formalize into a task, determine likely lane.  
**Thinking:** low  
**Why:** short-turn routing/classification is a good fit for OpenAI-style structured response models.

### 2. Zhongshu / Planning
**Default family:** Claude Code  
**Purpose:** turn rough demand into an execution-ready plan, split tasks, define acceptance criteria, shape implementation prompts.  
**Thinking:** medium  
**Why:** Claude Code is well suited to repo-aware planning and engineering-oriented task shaping.

### 3. Menxia / Deliberation
**Default family:** OpenAI  
**Purpose:** approve / reject the plan before execution; act as adversarial reviewer.  
**Thinking:** high  
**Why:** this should be **different from planning/execution** when those are on Claude Code.

### 4. Shangshu / Dispatch
**Default mode:** rule-first (no model call)  
**When a model is needed:** **MiniMax 2.7**  
**Purpose:** choose executor lane, choose session reuse/new session, resolve ambiguous dispatch language.  
**Thinking:** low  
**Why:** dispatch should be mostly deterministic; LLM use should be exceptional.

### 5. Liubu / Execution
**Default family:** Claude Code  
**Purpose:** perform actual implementation/research/writing work.  
**Thinking:** medium by default, higher only when task severity/complexity demands it.  
**Why:** execution is the natural home for Claude Code in the current environment.

### 6. Aegis / Quality Review
**Default family:** OpenAI  
**Purpose:** post-execution quality gate; check whether the result actually satisfies the task.  
**Thinking:** high  
**Why:** when execution is mainly Claude Code, Aegis should stay heterogeneous.

---

## Compact Routing Table
| Role | Default lane | Default purpose | Thinking |
|---|---|---|---|
| Taizi | OpenAI | intake / classify / summarize | low |
| Zhongshu | Claude Code | planning / task shaping | medium |
| Menxia | OpenAI | approval / veto / adversarial review | high |
| Shangshu | Rule-first, fallback MiniMax 2.7 | dispatch / coordination | low |
| Liubu | Claude Code | execution | medium |
| Aegis | OpenAI | post-execution review | high |

---

## Institutional Separation Rules
### Rule 1: Planner vs Deliberation must differ
If Zhongshu uses Claude Code, Menxia should use OpenAI.

If Zhongshu ever uses OpenAI due to fallback, Menxia should switch to Claude Code if feasible.

### Rule 2: Executor vs Aegis must differ
If Liubu uses Claude Code, Aegis should use OpenAI.

If Liubu uses OpenAI for any task, Aegis should try to use Claude Code.

### Rule 3: Dispatch is not a reasoning sink
Shangshu should stay **rule-first**.

Only call MiniMax 2.7 when the routing decision is genuinely ambiguous.

### Rule 4: Same-family fallback requires stricter posture
If system pressure forces the same family to both execute and review:
- use a **different session**
- raise thinking one level
- inject an explicit adversarial review instruction
- log the same-family fallback in task/audit metadata

---

## Fallback Policy
### Normal path
- Taizi -> OpenAI
- Zhongshu -> Claude Code
- Menxia -> OpenAI
- Shangshu -> rule-first / MiniMax 2.7 only when needed
- Liubu -> Claude Code
- Aegis -> OpenAI

### If OpenAI is unavailable / rate-limited
1. Taizi may fall back to Claude Code for intake
2. Menxia may fall back to Claude Code **only if**:
   - not the same live session as planner/executor
   - prompt explicitly frames it as adversarial deliberation
3. Aegis may fall back to Claude Code **only if** execution did not happen in that same family/session

### If Claude Code is unavailable
1. Zhongshu may fall back to OpenAI
2. Liubu may fall back to OpenAI for light execution tasks
3. If Liubu falls back to OpenAI, Aegis should try to use Claude Code later if it becomes available, otherwise review quality should be flagged as reduced-confidence

### If dispatcher needs model help and MiniMax 2.7 is unavailable
Fallback order:
1. MiniMax 2.7
2. OpenAI low-thinking lane
3. Claude Code low-thinking lane

But only for ambiguous routing; otherwise remain rule-first.

---

## Override Precedence
Routing resolution should follow this order:

1. **Task-level override**
   - `execution_model`
   - `review_model`
   - future `edict.role_overrides.*`
2. **Project-level Edict routing policy**
3. **Role default policy** from this document
4. **Existing agent config**
5. **Global defaults**

This ensures Edict can be policy-driven without breaking existing Mission Control behavior.

---

## Suggested Project Metadata Shape
```json
{
  "workflow_mode": "edict_v1",
  "edict": {
    "routing": {
      "taizi": { "family": "openai", "thinking": "low" },
      "zhongshu": { "family": "claude_code", "thinking": "medium" },
      "menxia": { "family": "openai", "thinking": "high" },
      "shangshu": {
        "mode": "rule-first",
        "fallback_family": "minimax",
        "fallback_model": "minimax-2.7",
        "thinking": "low"
      },
      "liubu": { "family": "claude_code", "thinking": "medium" },
      "aegis": { "family": "openai", "thinking": "high" }
    }
  }
}
```

Note: `minimax-2.7` is the logical policy target. The actual implementation should resolve this to the exact configured model id available in the environment.

---

## Practical Execution Flow
### Flow A: Normal software task
1. Taizi (OpenAI) classifies and frames
2. Zhongshu (Claude Code) writes execution plan
3. Menxia (OpenAI) approves/rejects the plan
4. Shangshu dispatches (rule-first; MiniMax only if needed)
5. Liubu (Claude Code) executes in project session
6. Aegis (OpenAI) reviews result

### Flow B: OpenAI degraded
1. Taizi may temporarily fall back to Claude Code
2. Menxia should not reuse planner/executor session
3. Aegis should log reduced-confidence if forced onto same family

---

## What v2 Does NOT Need Yet
- full persona prompts for each office
- separate dashboards for each role
- heavy RBAC
- vendor-specific hardcoding everywhere

v2 only needs a clear routing policy plus deterministic implementation hooks.

---

## Implementation Hooks (future)
When wiring this into Mission Control code, the likely touchpoints are:
- `src/lib/task-dispatch.ts`
- A new helper such as `src/lib/edict-role-routing.ts`
- project create/update API routes
- Aegis review invocation path
- task metadata serialization

---

## Final Recommendation
Given the current constraint of **OpenAI + Claude Code**, the best default institutional split is:

- **OpenAI** for intake, deliberation, and Aegis review
- **Claude Code** for planning and execution
- **MiniMax 2.7** only as the dispatch fallback when rule-first routing cannot decide

This gives the strongest role separation with the least operational complexity.
