# Agent Registry

**Version**: 1.0.0
**Date**: 2026-05-01
**Status**: Documentation reference. This file describes both runtime and planned agents. The runnable runtime source of truth is `data/mission-control/agent-registry.json`.

This document records Mission Control agent intent, scope, and operational contracts. It includes both implemented runtime agents and planned agents that are not wired yet.

Only agents present in `data/mission-control/agent-registry.json` are runnable by the coordinator. Agents documented here but absent from that JSON registry are planned only and must not be treated as active runtime agents.

---

## Passive Income Bot

**Runtime status**: PLANNED — documented contract only; not present in `data/mission-control/agent-registry.json`.

| Field | Value |
|---|---|
| Name | `passive-income-bot` |
| Domain | Business / product ideation and evidence validation |
| Max risk level | 1 (Draft) |
| Skills allowed | Web Research, Analytics, Memory/Evidence Log, PDF/Document Generation, Local Model |
| Skills blocked | Market Data, Paper Trading, Backtesting, Sports Odds, GitHub (write), Scheduler |
| Approval gates | Level 2+ requires Owner review; auto-publication blocked at all levels |
| Memory source | `source='passive-income-bot'`, `category='execution'` |
| Output format | Draft plan + evidence table (see BOT_OUTPUT_TEMPLATES.md) |
| First milestone | Scan a niche, produce an evidence-backed opportunity brief |

**Contract**: The bot may research, score hypotheses, and generate draft plans. It may not spend money, publish content, or contact external parties.

---

## Stocks / Trading Research Bot

**Runtime status**: PLANNED — documented contract only; not present in `data/mission-control/agent-registry.json`.

| Field | Value |
|---|---|
| Name | `stocks-research-bot` |
| Domain | Equity and ETF research, paper trading simulation |
| Max risk level | 2 (Test) |
| Skills allowed | Market Data, Backtesting, Paper Trading, Analytics, Memory/Evidence Log, Local Model |
| Skills blocked | Live brokerage APIs, any order-submission API |
| Approval gates | All simulated P&L reports require Owner review before sharing; Level 3+ blocked |
| Memory source | `source='stocks-research-bot'`, `category='execution'` |
| Output format | Simulation report + hypothesis scorecard |
| First milestone | Paper-trade a simple momentum strategy for 30 days |

**Contract**: Paper trading only. No brokerage account connections. No live order submission at any risk level without explicit Owner approval per trade.

---

## Sports Betting Bot

**Runtime status**: PLANNED — documented contract only; not present in `data/mission-control/agent-registry.json`.

| Field | Value |
|---|---|
| Name | `sports-betting-bot` |
| Domain | Sports odds research, edge detection, paper betting simulation |
| Max risk level | 2 (Test) |
| Skills allowed | Sports Odds, Analytics, Backtesting, Memory/Evidence Log, Local Model |
| Skills blocked | Any real bookmaker account API, payment APIs |
| Approval gates | All bet recommendations blocked until evidence score ≥ 0.65; Level 3+ blocked |
| Memory source | `source='sports-betting-bot'`, `category='execution'` |
| Output format | Edge report + paper bet log |
| First milestone | Track 50 paper bets with full evidence log over one season |

**Contract**: Paper betting only. No real wagers at any level without Owner approval per event. "No edge means no bet" — the bot must produce a calculable positive expected value before logging even a paper bet.

---

## Appliance Intelligence Bot

**Runtime status**: PLANNED — documented contract only; not present in `data/mission-control/agent-registry.json`.

| Field | Value |
|---|---|
| Name | `appliance-bot` |
| Domain | Appliance fault diagnosis, repair guidance, parts research |
| Max risk level | 1 (Draft) |
| Skills allowed | Web Research, Memory/Evidence Log, PDF/Document Generation, Local Model |
| Skills blocked | All financial skills |
| Approval gates | Repair recommendations must include a validated test procedure |
| Memory source | `source='cli'`, `category='execution'` (intentionally shares the existing seeded appliance corpus — do not change without migrating existing entries) |
| Output format | Fault tree + repair checklist |
| First milestone | Diagnose 10 real appliance faults from symptom descriptions |

---

## Builder / Coding Bot

**Runtime status**: PLANNED in Mission Control runtime registry. This repo contains builder-oriented code paths, but no `builder-bot` entry exists in `data/mission-control/agent-registry.json`.

| Field | Value |
|---|---|
| Name | `builder-bot` |
| Domain | Code generation, CI/CD, dependency management, this repo |
| Max risk level | 3 (Controlled Action) |
| Skills allowed | GitHub Skill (draft PRs), Package Hygiene, Memory/Evidence Log, Local Model |
| Skills blocked | Production deploy, force-push main, schema drops |
| Approval gates | Production deploys require Owner approval; major dependency upgrades require Owner approval |
| Memory source | `source='builder-bot'`, `category='execution'` |
| Output format | PR diff + test results |
| First milestone | Ongoing — always at the active phase boundary |

---

## Research Scout

**Runtime status**: PLANNED — documented contract only; not present in `data/mission-control/agent-registry.json`.

| Field | Value |
|---|---|
| Name | `research-scout` |
| Domain | Literature review, competitive analysis, web intelligence |
| Max risk level | 1 (Draft) |
| Skills allowed | Web Research, Analytics, Memory/Evidence Log, Local Model |
| Skills blocked | All write-to-external, all financial |
| Approval gates | All published summaries require Owner review |
| Memory source | `source='research-scout'`, `category='execution'` |
| Output format | Research brief + source table |
| First milestone | Produce weekly competitive landscape brief |

---

## Content / Design Bot

**Runtime status**: PLANNED — documented contract only; not present in `data/mission-control/agent-registry.json`.

| Field | Value |
|---|---|
| Name | `content-bot` |
| Domain | Copywriting, image prompts, social media drafts |
| Max risk level | 1 (Draft) |
| Skills allowed | Image Generation, PDF/Document Generation, Web Research, Local Model |
| Skills blocked | Auto-publish to any platform |
| Approval gates | All outputs are drafts; publication requires Owner explicit approval |
| Memory source | `source='content-bot'`, `category='execution'` |
| Output format | Draft content + asset bundle |
| First milestone | Produce a landing page draft for one passive income product |

---

## Systems Curator

**Runtime status**: ACTIVE — present in `data/mission-control/agent-registry.json` and runnable by the coordinator as an observe-only agent.

| Field | Value |
|---|---|
| Name | `systems-curator` |
| Domain | Memory review, quality gates, scheduling, bot health |
| Max risk level | 2 (Test) |
| Skills allowed | Memory/Evidence Log, Scheduler, Analytics |
| Skills blocked | All domain actions, all financial |
| Approval gates | Escalation to Owner required for any flagged entry disposition |
| Memory source | N/A — reads from all sources via review queue; does not write execution entries |
| Output format | Health report + escalation notification |
| First milestone | N/A — meta-agent activated when first domain bot goes live |
| Notes | Does not originate domain tasks; only routes, audits, and escalates |

---

## Notes

- Runtime-runnable agents are defined in `data/mission-control/agent-registry.json`.
- This markdown file may describe planned agents that do not yet exist in the runtime registry.
- Risk levels are enforced by the approval gate middleware (see RISK_AND_APPROVAL_POLICY.md)
- Memory sources must be unique per bot so the review queue can attribute signals correctly
