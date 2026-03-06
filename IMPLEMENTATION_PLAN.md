# Implementation Plan — Agent Skills Tab

## Phase 1: Backend Utilities

- [x] **1. Create `src/lib/agent-skills.ts`** — Skill discovery utility
  - Function `discoverSkills(agentWorkspace: string)` that scans:
    - `~/.openclaw/skills/` (global, source: "global")
    - `/opt/homebrew/lib/node_modules/openclaw/skills/` (npm, source: "npm")
    - `<agentWorkspace>/skills/` (workspace, source: "workspace")
  - Each skill = directory containing SKILL.md
  - Parse YAML frontmatter for name + description
  - Deduplicate: workspace > global > npm
  - Return array of `{ id, name, description, source, enabled, skillMdPath }`
  - "enabled" = exists as symlink or dir in agent workspace `skills/`
  - If agent has no workspace `skills/` dir, all skills considered enabled

- [x] **2. Resolve agent workspace paths**
  - Read `~/.openclaw/openclaw.json` → `agents.list[]` → find agent by id → return `workspace` path
  - Add to `agent-skills.ts` or reuse existing `lib/agent-workspace.ts`

## Phase 2: API Endpoints

- [x] **3. GET `/api/agents/[id]/skills`** — List all skills with enabled state
  - Resolve agent workspace from config
  - Call `discoverSkills(workspace)`
  - Return `{ skills: [...] }`

- [x] **4. PUT `/api/agents/[id]/skills/[skillId]`** — Toggle skill on/off
  - Request: `{ enabled: boolean }`
  - Enable: create symlink `<workspace>/skills/<id>` → source skill path
  - Disable: remove symlink only (never delete actual dirs)
  - Create `<workspace>/skills/` dir if needed

- [x] **5. GET `/api/agents/[id]/skills/[skillId]/content`** — Read SKILL.md
  - Return `{ content, path, readOnly }` (readOnly if npm source)

- [x] **6. PUT `/api/agents/[id]/skills/[skillId]/content`** — Save SKILL.md
  - Write content to disk. Reject if npm source (readOnly).

## Phase 3: UI Component

- [x] **7. Create `SkillsTab` component in `agent-detail-tabs.tsx`**
  - List view: skill rows with name, description, source badge, toggle
  - Sort: enabled first, then alphabetically
  - Click row → detail/edit view
  - Detail view: BlockEditor with SKILL.md content (read-only for npm)
  - Save button (when editable)
  - Back button to return to list
  - Use `Button` component, dark theme tokens, existing patterns

## Phase 4: Integration

- [x] **8. Register Skills tab in `agent-squad-panel-phase3.tsx`**
  - Add `{ id: 'skills', label: 'Skills', icon: '⚡' }` to tabs array
  - Add type to activeTab union
  - Render `<SkillsTab agent={agent} />` when active
