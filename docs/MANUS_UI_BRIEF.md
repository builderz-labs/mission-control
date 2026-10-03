# Manus UI Brief — AI Ops Hub v0.1

Use this brief to prototype UI only. Do not redesign the backend or invent a new data model.

## Product
AI Ops Hub is a local control center for one operator managing multiple AI-assisted projects.

Initial projects:
- Shufuro
- ProductBaton

The app is a customized fork of Mission Control. Existing React/Tailwind components and data APIs should be reused where possible.

## Most important rule
The first screen is not a generic analytics dashboard.

It must answer:
**“What do I need to approve or decide right now?”**

## Desktop information architecture
Left navigation:
1. Home
2. Projects
3. Marketing
4. Development

OPERATE:
- Agents
- Usage
- Skills
- Automations
- Activity
- All Tasks

ADVANCED:
- Chat
- Logs
- GitHub
- Integrations
- Security
- Audit
- Settings

## Home
First viewport:
### Approval Inbox
Large, visually dominant list.

Each approval card shows:
- Project
- Domain (Marketing / Development / Operations)
- Task title
- Source reference (example: EP002)
- Chosen format or implementation target
- Current review state
- One-line next action
- Buttons: View / Hold / Request Changes / Approve

Below Approval Inbox:
- Running now
- Failed / blocked
- Scheduled next
- Recent completions
- Agent usage snapshot

Avoid large decorative graphs above the approval queue.

## Projects
Project cards for Shufuro and ProductBaton.

Each card:
- project name
- short purpose
- total tasks
- approvals waiting
- running
- failed
- buttons: Tasks / Marketing / Development

## Marketing
Work queue optimized for:
Review → Ready → Render → QA → Publish → Measure.

Rows show:
- Project
- episode/content ID
- selected format
- state
- next action
- publish/measurement state

Do not assume every episode has both Reel and Carousel.
From EP002 onward, only one chosen format is produced unless an explicit experiment says otherwise.

## Development
Work queue optimized for:
Task → Agent → Implement → Test → Fix → Build → Human Gate → Push/Deploy.

Rows show:
- project
- task
- agent
- test/build state
- retry count
- next gate

## Usage
Show only measurable data.
- Agent/runtime
- Runs
- Tokens
- Estimated API-equivalent cost when meaningful
- Project attribution
- Failures / retries
- Local compute (Remotion, Qwen, FFmpeg) clearly separated from paid API usage

Do not fabricate ChatGPT product quota percentages if the product does not expose them.

## Skills
This page should feel like a package manager.

Installed view:
- Name
- Source root
- Description
- Security status
- Global/project source
- Search/filter

Skill detail:
- SKILL.md preview/editor
- Security scan
- Source path
- Delete/disable where supported

Registry:
- Search
- Version/author/source
- security result
- Install

Future assignment layer:
- Global
- Marketing
- Development
- Shufuro
- ProductBaton

## Automations
Readable workflow cards, not raw cron strings first.

Examples:
- Shufuro content review every 2 days
- Post performance measurement after 72h
- ProductBaton marketing
- Build → Test → Fix

Each card:
- enabled/disabled
- trigger
- last run
- next run
- last result
- human gate location

## Visual direction
- Dense enough for desktop operations, but calmer than a developer monitoring console.
- Human decisions are louder than telemetry.
- Reuse existing light/dark tokens.
- Rounded cards, strong spacing hierarchy.
- Amber = approval/waiting.
- Cyan/blue = running.
- Red = failed/blocked.
- Green = complete.
- Avoid excessive gradients, neon, or sci-fi command-center decoration.

## Output requested from Manus
Create editable desktop-first mockups for:
1. Home / Approval Inbox
2. Projects
3. Marketing
4. Development
5. Usage
6. Skills
7. Automations

Then produce a compact design spec:
- spacing
- typography
- card rules
- status chips
- table/list behavior
- responsive behavior

The mockups must be implementable in an existing Next.js + React + Tailwind codebase.
