# Organizational Brain + Department Learning + Social Measurement v0.1

## Goal

Use Obsidian as the company's durable knowledge brain while keeping Control Tower as the operational control plane.

- Obsidian: validated strategy, decisions, benchmarks, playbooks, skills, experiment/evidence summaries.
- Control Tower DB: live state, approvals, raw observations, typed evidence, cost, routing, improvement candidates.
- Factories: specialized execution workflows.
- Learning Engine: one shared evidence/eval/promotion loop across departments.

Raw evidence is never promoted to durable knowledge automatically.

## Departments

The code registry defines:
- Product
- Engineering
- Marketing
- Creative / Video
- Growth
- VOC / Research
- Revenue / Sales
- Operations / Control Tower

Each department specifies mission, inputs/outputs, metrics, evidence types, learning triggers, brain path, skills and model-escalation policy.

## Department Memory Loop

Observe -> capture raw evidence -> summarize/link in Obsidian -> deterministic aggregation -> repeated signal -> Improvement Candidate -> eval -> independent review if required -> human promotion gate -> promote playbook/skill -> observe -> reinforce/decay/rollback.

## Cost-aware execution

Tier 0: local deterministic.
Tier 1: ChatGPT orchestration/reasoning.
Tier 2: Codex for multi-file implementation/test loops.
Tier 2: Claude for independent design/creative/long-context critique.
Tier 3: independent review + human gate for high-risk/high-value work.

Default paid API hard cap remains $0/day. Optimizer auto-run and learned-skill auto-trust remain off.

## External self-improvement / analytics candidates

Active:
- skillmem: current local read-only memory compatibility.

Candidate only:
- GEPA / DSPy GEPA: prompt/component optimization only with an explicit eval set and budget.
- EvoAgentX: isolated research candidate.
- Agent Lightning: future benchmark-driven training only when a large repeatable benchmark justifies it.
- Umami: preferred lightweight first-party web/campaign analytics candidate.

Hold:
- PostHog: powerful but heavier than current needs.
- n8n: orchestration overlap plus extra operational/license surface.

No candidate is installed/promoted automatically by this registry.

## Social Measurement Layer

Canonical channels:
Instagram, TikTok, LinkedIn, X, Threads.

Canonical identity:
content_id, campaign_id, channel, post_id, published_at, creative_variant, hook_variant, cta_variant and UTM fields.

Metrics are nullable and never inferred when unavailable:
impressions, views, reach, profile_visits, link_clicks, likes, comments, shares, reposts, saves, follows/follower_delta, watch time, average watch time, completion, signup, activation, conversion and actual spend.

Snapshots are point-in-time cumulative observations. Channel rollups use only the latest snapshot per post so repeated snapshots do not inflate totals.

## API

- GET /api/departments
  - department registry
  - cost-aware execution policy
  - external capability candidate registry
- GET /api/marketing/social-metrics
  - latest stored snapshots and channel rollups
- POST /api/marketing/social-metrics
  - operator-only manual/import snapshot ingestion

Until platform credentials are connected, social data enters through manual/official-export import. Official APIs are the preferred future connectors. Scraping is not a default adapter.

## Obsidian Brain

Local vault additions:
20 Areas/AI Company OS/
- 00_COMPANY_BRAIN_HUB.md
- 01_DEPARTMENT_MEMORY_LOOP_AND_SOP.md
- 02_SOCIAL_MEASUREMENT_AND_ATTRIBUTION.md
- 03_COST_AWARE_EXECUTION_POLICY.md
- Departments/*
- Benchmarks/00_EXPERT_BENCHMARK_LIBRARY.md
- Templates/*

## Safety

- Native Product/Shufuro Sources of Truth remain authoritative.
- No social posting automation is enabled.
- No platform credentials are stored by this change.
- No external paid API is called.
- No fake social metrics are created.
- GEPA/EvoAgentX/Agent Lightning are not auto-run.

## v0.2 operational additions

- Every department has an explicit read-only-active skillmem recall policy.
- Direct agent writes/trust remain disabled; promotion flows through Control Tower evidence/eval/review/human gate.
- promptfoo is a local-first eval candidate; GEPA stays experiment-only; MemSkill is hold/watchlist due overlap.
- Social connector registry covers Instagram, TikTok, LinkedIn, X and Threads.
- Official APIs are preferred. Ad-only open-source connectors are not treated as organic performance sources.
- First-party `website_visits` and `website_unique_visitors` are normalized alongside social metrics.
- Rollups merge the newest observed value per metric/post so sparse platform and web snapshots do not erase one another.
- No credentials, posting automation, scraping, fake data or paid APIs were enabled by this change.
