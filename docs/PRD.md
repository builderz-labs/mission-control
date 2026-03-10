# Marcuzx Forge PRD

## Product
Marcuzx Forge is the public AI engineering platform brand built on top of the existing Mission Control dashboard and local orchestration assets. Its internal operating identity is Eak AI Factory.

## Problem
The current workspace contains useful but fragmented assets: a real-time dashboard, a local orchestration prototype, and an embedded CrewAI source tree. The platform needs a coherent control plane, standards, registry, memory, and agent operating model.

## MVP Goal
Deliver a first working factory that can register projects, document current and target architecture, define agent roles, provide a control center path, expose observability status, and create reviewable engineering artifacts without rewriting the existing app.

## Primary Users
- Platform owner operating multiple AI engineering projects
- Human reviewer validating agent output
- Future autonomous agents consuming shared standards, registry, and memory

## MVP Scope
- File-based platform structure under `marcuzx-forge/`
- Standardized documentation set for the repo and each initialized module
- Machine-readable project registry populated from discovered local projects
- Agent specification set for architect, coder, reviewer, tester, devops, and research agents
- File-based memory layer for decisions, patterns, summaries, and snapshots
- New control/observatory UI routes under `/forge`

## Out Of Scope
- Full multi-repo remote automation
- Production database-backed memory system
- Automatic GitHub provisioning across external repositories
- Replacement of the existing Mission Control runtime
