# Dashboard layout and LLM branding audit

Date: 2026-09-06

## Result

Every built-in panel now renders inside one `DashboardPageFrame`. The frame gives each route a deliberate dashboard canvas while preserving the panel's existing data loading and interactions.

| Layout | Routes | Behavior |
| --- | --- | --- |
| Workspace | chat, gateway-config, knowledge-graph, logs, memory, notifications, office, standup, tasks | Full-height canvas for boards, editors, logs, and split panes |
| Wide | agents, channels, cron, fly, overview, skills, super-admin | 96rem maximum width for dense operational dashboards |
| Standard | activity, alerts, audit, cost-tracker, debug, exec-approvals, gateways, github, integrations, monitor, nodes, security, settings, users, webhooks | 80rem readable width for forms, reports, and administration |
| Fallback | plugin and unknown routes | Standard canvas with a labeled page landmark |

Loading, error, empty, and access-denied branches retain their page-level heading. The route frame exposes `data-dashboard-page` and `data-dashboard-layout` for regression checks and future plugin QA.

## LLM identity system

`EngineLogo`, `EngineLogoForText`, `EngineLogoSet`, and `LlmLabel` provide a single presentation path for model and provider identity.

| Text family | Logo |
| --- | --- |
| Claude, Anthropic, Haiku, Sonnet, Opus, Claude 1, Claude 2 | Claude |
| Codex, OpenAI, GPT model IDs | Codex/OpenAI |
| Kimi, Moonshot | Kimi |
| Grok, xAI | Grok |

The shared labels are applied to the Overview fleet and session workbench, activity sources, chat model and handoff pickers, session rows and headers, cost reporting, agent cards and model configuration, skills sources, settings/runtime controls, onboarding provider/model controls, terminal sessions, Claude task/team bridges, and workspace provisioning controls.

Native `<select>` options cannot contain images. Those controls keep native keyboard and screen-reader behavior and show the logo beside the selected value or field label.

Decorative logos next to visible model text use empty alternative text to avoid duplicate screen-reader announcements. Standalone model logos retain an accessible provider label.

## Overview terminal sessions

The former `Dock an Agent` launch-sequence gate was removed from Overview. A persistent `Active Terminal Sessions` region now renders every active item from the unified sessions API, including local Claude, Codex, Grok, Kimi, Hermes, and OpenCode work plus remote gateway sessions. Each row shows its engine identity, owner or project, activity age, and an explicit `Local CLI` or `Remote` source label, then opens the matching session workspace. Realtime gateway updates now preserve session IDs and source metadata so those labels and links remain correct after websocket refreshes.

## Preview verification

- Swept all 31 built-in routes plus an unknown-route fallback in Codex Preview.
- Confirmed the expected `standard`, `wide`, or `workspace` frame on every route.
- Confirmed page-level headings after loading and in loading/error/empty/access-denied branches.
- Confirmed zero document-level horizontal overflow on every desktop route.
- Confirmed zero horizontal overflow at 390 × 844 for representative standard, wide, and workspace pages and the unknown-route fallback.
- Opened the chat model picker and confirmed provider logos for Claude, Codex/GPT, Kimi, and Grok engine rows and every model row.
- Exercised the Codex session filter and confirmed it reduced the workbench to the Codex group.
- Opened the Claude runtime setup flow and confirmed the branded setup state rendered.
- Confirmed the Overview rendered every live unified session, removed all `Dock an Agent` copy, and opened the selected Codex transcript.
- Confirmed the active-session region had zero horizontal overflow at 1440 × 1000 and 390 × 844.
- Confirmed no visible Next.js error overlay and no browser console errors or warnings in the final responsive run.
- `git diff --check` passed.

Repository release tests, lint, typecheck, build, and Playwright remain pending because the required Mission Control Fly leaf tools are unavailable in this environment while the host has the Fly offload-required flag set. This audit does not override the production-release blockers recorded in `mission-control-production-audit.md`.
