---
type: "query"
date: "2026-09-20T19:24:59.239328+00:00"
question: "Where should a Jev decision dashboard live across the repository fleet, and how should it integrate with Mission Control?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Dashboard()", "INTEGRATIONS", "runs.ts", "tasks", "github-sync-engine.ts", "provider-subscriptions.ts", "runtime"]
---

# Q: Where should a Jev decision dashboard live across the repository fleet, and how should it integrate with Mission Control?

## Answer

Expanded from the original query via graph vocabulary: [dashboard, agents, provider, projects, repository, github, integrations, workflows, tasks, runs, runtime, observability]. The graph shows Mission Control already connects dashboard panels, integrations, task dispatch, agent runtimes, GitHub synchronization, workspace-scoped runs, evals, provenance, events and observability. The recommended architecture is an isolated provider-neutral decision-intelligence module inside Mission Control, with TypeSafe Jev as a server-side adapter, versioned policies, an immutable evaluation ledger, confidence-gated human review and no direct model-owned side effects.

## Outcome

- Signal: useful

## Source Nodes

- Dashboard()
- INTEGRATIONS
- runs.ts
- tasks
- github-sync-engine.ts
- provider-subscriptions.ts
- runtime