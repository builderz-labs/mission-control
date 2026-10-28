# AI Ops Hub v0.1 — Product/Architecture Plan

## Goal
Turn Builderz Labs Mission Control into a local AI operations hub for the user's projects. Shufuro Marketing is the first workflow, but the system must also support ProductBaton marketing, app development, agent usage tracking, and AI skill management.

## Operating principle
The hub is always-on/background-capable. The user should not need to launch a command for every job.

Primary human loop:
1. Open dashboard.
2. See items requiring approval first.
3. Approve / request changes / hold.
4. Background runner continues the approved workflow.
5. Return only when another human decision is required.

## Upstream base
- Repo: https://github.com/builderz-labs/mission-control
- License: MIT
- Local stack: Next.js 16 / React 19 / TypeScript / SQLite / Zustand / Recharts
- Existing useful systems: tasks, projects, skills hub, agents, sessions, costs, schedules, webhooks, activity, quality gates, local Claude/Codex discovery.
- Upstream remote in this worktree: `upstream`
- Custom branch: `feat/ai-ops-hub-v0.1`

## Keep / Modify / Hide / Add

| Upstream surface | Decision | AI Ops Hub v0.1 |
|---|---|---|
| Tasks + review states | KEEP + MODIFY | foundation for Approval Inbox and workflows |
| Projects | KEEP + MODIFY | Shufuro, ProductBaton, future projects |
| Skills Hub | KEEP + MODIFY | global/project skills, source/version/update/enable state |
| Agent/session discovery | KEEP | Claude Code, Codex, local agents |
| Cost/token tracking | KEEP + MODIFY | Usage page with per-agent/project summaries |
| Activity/logs | KEEP | execution history and failure evidence |
| Cron/scheduler | KEEP | 2-day marketing cadence, 72h metrics jobs |
| Quality gates | KEEP + MODIFY | human approval gate before publish/deploy |
| GitHub integration | KEEP | repo/task linkage |
| Memory | KEEP, secondary | Obsidian remains project source-of-truth |
| Security/audit | KEEP, secondary | local security and skill scan |
| Gateways/OpenClaw | HIDE by default | not required for initial local workflow |
| Channels/Nodes/Office | HIDE by default | not needed for v0.1 |
| Multi-user admin | HIDE by default | single-user local product first |
| Super Admin | HIDE | not needed |
| Approval-first Home | ADD | first screen is Human Inbox |
| Marketing workspace | ADD | queue → review → render → publish → 72h metrics |
| Development workspace | ADD | task → agent → test/build → approval → push/deploy |
| Workflow templates | ADD | reusable recipe per project/domain |
| Skill assignment matrix | ADD | Global / Marketing / Development / per-project |
| Runner health | ADD | background worker status and last successful action |

## v0.1 Navigation

### 1. Home
Approval-first dashboard:
- Approval Inbox (largest area)
- Running now
- Failed / blocked
- Due today / scheduled next
- Agent usage summary
- Recent completions

### 2. Work
- Marketing
- Development
- General tasks

Marketing filters tasks by domain metadata and shows:
- project
- episode/job
- current state
- chosen format
- next gate
- publish status
- 72h measurement state

Development shows:
- implementation task
- assigned agent
- tests/build state
- retry count
- push/deploy gate

### 3. Projects
- Shufuro
- ProductBaton
- future projects
Each project links workflows, repos, Obsidian source paths, agents, skills and usage.

### 4. Agents
Existing runtime/session visibility, simplified for local Claude/Codex first.

### 5. Usage
- runs by agent
- tokens / estimated API-equivalent cost where measurable
- project breakdown
- model breakdown
- failures/retries
- local tools shown separately as free/local compute

### 6. Skills
Existing Skills Hub plus:
- Source
- Installed version / upstream state
- Last checked
- Enabled/disabled
- Global vs project assignment
- Used by which workflows
- Update available
- Remove/update/install actions

### 7. Automations
Existing Cron + workflow templates:
- Shufuro content every 2 days
- 72h post measurement
- ProductBaton content
- Build → Test → Fix
- future workflows

### 8. Activity
Existing unified activity/log view.

### Advanced
Settings, Integrations, Security, Audit, GitHub. Hide infrastructure-heavy panels by default.

## Approval Inbox data model
Use Mission Control tasks as the underlying entity. v0.1 treats these states as requiring human attention:
- review
- quality_review
- blocked with human_required metadata
- explicit approval task type

Recommended metadata:
```json
{
  "domain": "marketing",
  "project_slug": "shufuro",
  "workflow": "content_publish",
  "approval_type": "content",
  "source_ref": "EP002",
  "artifact_path": "...",
  "selected_format": "carousel",
  "next_action": "render"
}
```

## First workflow — Shufuro Marketing
```
REVIEW packet
→ Home Approval Inbox
→ Founder approve / revise / hold
→ READY
→ choose exactly one format from EP002 onward
→ render with Remotion
→ QA
→ publishing operator (Codex/Computer Use)
→ verify URL
→ POSTED
→ schedule 72h measurement
→ MEASURED
→ feed result into next format decision
```

EP001 remains an explicit seed exception: Instagram carousel + TikTok video both published for format comparison.

## Background behavior
Windows startup launches the local server + runner. Runner watches Mission Control task state and executes only transitions that are allowed by workflow policy. Human gates must not be bypassed.

Push/deploy/publish rules remain workflow-specific. Browser login/CAPTCHA/2FA always pauses for user action.

## Design direction
- Default local web/PWA.
- Dashboard density lower than upstream Mission Control.
- Human decisions are visually louder than system telemetry.
- Neutral light/dark compatible UI.
- Status colors reserved for action semantics: approval, running, blocked, failed, complete.
- First viewport must answer: "What do I need to decide right now?"

## UI prototyping
Manus is not currently available as a connected ChatGPT plugin in this environment. Existing Figma connector can be used for editable design work, or MagicPath can be connected later if desired. Initial v0.1 will adapt the existing React/Tailwind UI directly so we do not duplicate the product in another builder.

## v0.1 implementation order
1. Approval-first dashboard.
2. Simplified AI Ops navigation.
3. Marketing / Development filtered workspaces.
4. Usage surface based on existing token/cost/session data.
5. Skills Hub adaptation.
6. Shufuro workflow bridge.
7. Background startup/runner.
8. ProductBaton workflow template.
