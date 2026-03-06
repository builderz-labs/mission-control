# Projects Panel + Sidebar Section

## Overview
Add a dedicated Projects panel and a sidebar section showing top 3 recently active projects. Clicking a project opens a project detail view with editable header + filtered task list.

## Requirements

### 1. Sidebar: Recent Projects Section
In the nav rail sidebar (`src/components/layout/nav-rail.tsx`), add a "Projects" section under the Core section items.

- Show top 3 projects sorted by most recent task activity (latest `updated_at` of any task in the project)
- Each item: `emoji + title` as a clickable row
- Clicking a project → opens the Projects panel with that project selected
- Below the 3 items: a "View all" link/button → opens the Projects panel (no project selected, showing the full list)
- If no projects exist: don't show the section
- Styling: same as other sidebar nav items, slightly smaller text (`text-sm`)

### 2. Projects Panel (new panel)
Create `src/components/panels/projects-panel.tsx` — a new panel accessible from the sidebar.

**List View (default, no project selected):**
- Header: "Projects" title + "New Project" button (outline variant)
- List of all projects as cards/rows:
  - Emoji + Title (clickable → selects the project)
  - Description (one line, truncated)
  - Task count badge (total tasks in project)
  - Last activity date
- Sort by recent activity (same as sidebar)
- "New Project" opens a small inline form or modal: title, emoji picker (just a text input for emoji), description (BlockEditor)

**Project Detail View (project selected):**
- **Editable header section:**
  - Emoji — clickable to change (simple text input)
  - Title — editable inline (borderless text input, `text-2xl font-bold`, same style as task title)
  - Description — `BlockEditor` with `compact` prop, placeholder "Add project description..."
  - Task count + last activity as muted metadata
  - Back arrow button (ghost, icon) → returns to project list
  - Save happens on blur (auto-save, no explicit save button)
- **Task list below the header:**
  - Reuse the existing task list/board rendering from `task-board-panel.tsx`, OR render a simplified task list (title + status chip + priority chip + assignee chip per row)
  - Only shows tasks with `project_id` matching this project
  - "New Task" button that pre-fills the project assignment
  - Clicking a task opens the TaskDetailModal (same as in task board)

### 3. API Endpoints
- `GET /api/projects` — already exists, may need to add task counts and last activity
- `PUT /api/projects/[id]` — update project title, description, emoji. Create this endpoint.
- `POST /api/projects` — create new project manually (without AI). Create this endpoint.
- `DELETE /api/projects/[id]` — archive/delete project. Create this endpoint.

### 4. Navigation Integration
- Add "Projects" to the nav rail in the Core section (after Feed, before Crew — or wherever it fits naturally)
- Panel ID: `projects`
- Icon: use `Folder` from iconoir-react (or similar)
- Register in the Zustand store's panel list

## Technical Notes
- Nav rail: `src/components/layout/nav-rail.tsx`
- Panel registration: check how other panels are registered (Zustand store, panel map)
- Reuse `PropertyChip`, `Button`, `BlockEditor`, `AgentAvatar` components
- Task list in project detail: can be a simplified version — doesn't need the full kanban board
- **Tailwind v3.4** — bracket syntax for CSS vars, `z-[-1]` not `-z-1`
- All new buttons must use `<Button>` component
- All multi-line text must use `<BlockEditor>`
- Check `src/components/ui/` before creating any new primitives

## Acceptance Criteria
- [ ] Build passes (`npx next build`)
- [ ] Sidebar shows top 3 projects by recent activity with emoji + title
- [ ] "View all" in sidebar opens the Projects panel
- [ ] Clicking a sidebar project opens Projects panel with that project selected
- [ ] Projects panel list view: shows all projects with title, description, task count
- [ ] Projects panel detail view: editable emoji, title (inline borderless), description (BlockEditor)
- [ ] Back button returns to project list
- [ ] Auto-save on blur for project edits (PUT /api/projects/[id])
- [ ] Task list in detail view shows only that project's tasks
- [ ] Clicking a task opens TaskDetailModal
- [ ] "New Task" in detail view pre-fills project assignment
- [ ] "New Project" in list view works (POST /api/projects)
- [ ] PUT /api/projects/[id] endpoint works
- [ ] Dark mode correct throughout
- [ ] No raw HTML elements — all using project components
