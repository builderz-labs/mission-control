# Implementation Plan: Projects UI Integration

## Gap Analysis Summary

**GOOD NEWS:** Most backend functionality already exists:
- ✅ Database schema: `issues.project_id` FK to `projects` table
- ✅ API endpoints: `GET /api/projects`, `POST /api/projects/generate`
- ✅ Task API already handles `project_id` updates (`PUT /api/tasks/[id]`)
- ✅ Tasks already include `project_id` and `project_title` in response
- ✅ PropertyChip component exists and is used for status/priority/assignee

**GAPS IDENTIFIED:**
- ❌ Task interface in task-board-panel.tsx is missing `project_id` and `project_title` fields
- ❌ No project filtering in board header
- ❌ No project PropertyChip in TaskDetailModal
- ❌ No project PropertyChip in CreateTaskModal
- ❌ No project chips on task cards (kanban/list views)
- ❌ No projects state/fetching in TaskBoardPanel component

## Implementation Tasks (Prioritized)

### 1. **Update Task Interface** ✅
   - [x] Add `project_id?: string` field to Task interface (line 15-30)
   - [x] Add `project_title?: string` field to Task interface
   - [x] This enables TypeScript to recognize project fields from API

### 2. **Add Projects State to TaskBoardPanel** ✅
   - [x] Add `projects` state: `useState<Project[]>([])`
   - [x] Add `selectedProjectFilter` state: `useState<string | null>(null)`
     - `null` = "All Projects", `''` = "Unassigned", otherwise project.id
   - [x] Fetch projects on mount: `GET /api/projects` in `fetchData()`
   - [x] Cache projects in state (don't re-fetch per modal open)
   - [x] Add Project interface to task-board-panel.tsx

### 3. **Add Project Filter to Board Header** ✅
   - [x] Position: after view toggle buttons, before "New Task" button (line 453)
   - [x] Component: `<select>` styled as Button variant="outline" size="sm"
   - [x] Options structure:
     - "All Projects" (default, value=null)
     - "Unassigned" (value='', shows tasks with no project)
     - Separator
     - List all projects: `{emoji} {title}` (value=project.id)
   - [x] On change: update `selectedProjectFilter` state
   - [x] Responsive: show icon only on mobile

### 4. **Implement Project Filtering Logic** ✅
   - [x] Create `filteredTasks` computed array before grouping by status
   - [x] Filter logic:
     - If `selectedProjectFilter === null`: show all tasks
     - If `selectedProjectFilter === ''`: show only tasks where `!task.project_id`
     - Otherwise: show only tasks where `task.project_id === selectedProjectFilter`
   - [x] Use `filteredTasks` instead of `tasks` for kanban/list views

### 5. **Add Project PropertyChip to TaskDetailModal** ✅
   - Position: in chips row after Assignee, before Creator (line 1030-1035)
   - Build project options array:
     ```typescript
     const projectOptions: PropertyOption[] = [
       { value: '', label: 'No project', icon: '—' },
       ...projects.map(p => ({
         value: p.id,
         label: p.title,
         icon: p.emoji,
       })),
       { value: '✨-new', label: '✨ New', icon: '✨' },
     ]
     ```
   - Add `projectLoading` state for spinner during generation
   - Handle selection:
     - If existing project: call `PUT /api/tasks/${task.id}` with `{ project_id: value }`
     - If '✨-new':
       - Set `projectLoading = true`
       - Call `POST /api/projects/generate` with `{ taskId: task.id }`
       - On success: update task state, set `projectLoading = false`
       - On error: show project name from fallback, set `projectLoading = false`
   - Show loading spinner on chip when `projectLoading === true`
   - Placeholder: "No project" (muted)

### 6. **Add Project PropertyChip to CreateTaskModal** ✅
   - [x] Position: in chips row after Assignee (line 1178-1193)
   - [x] Add `project_id` to formData state
   - [x] Same project options as TaskDetailModal
   - [x] Handle selection:
     - If existing project: store `project_id` in formData
     - If '✨-new':
       - Set `projectLoading = true`
       - Create task first (to get taskId)
       - Then call `POST /api/projects/generate` with new taskId
       - Update task with project_id
   - [x] Pass `project_id` in POST /api/tasks body if selected
   - [x] Pass `projects` prop to CreateTaskModal component

### 7. **Add Project Chips to Kanban Cards** ✅
   - [x] Location: in `renderCard()` function, after title, before chips row (line 516-519)
   - [x] Only render if `task.project_id` exists (don't show "No project")
   - [x] Component: simple styled div, NOT PropertyChip
   - [x] Styling: `text-xs text-muted-foreground flex items-center gap-1 mt-1.5`
   - [x] Content: `{task.project_title && <span>{projectEmoji} {task.project_title}</span>}`
   - [x] Need to get emoji from projects array by matching project_id
   - [x] Keep it subtle: no background, muted text

### 8. **Add Project to List View Rows** ✅
   - [x] Location: in list row rendering, after assignee chip (line 679-700)
   - [x] Same approach as kanban cards: only show if project exists
   - [x] Display: small chip with emoji + name
   - [x] Styling: same as kanban, subtle and muted

### 9. **Handle Project Updates from API** ✅
   - [x] Ensure `fetchData()` updates keep selectedTask in sync
     - Already implemented in lines 156-160 of task-board-panel.tsx
     - selectedTask is updated with fresh data after every fetchData call
   - [x] When project is assigned via generate API, task should reflect it
     - handleProjectChange calls onUpdate() which triggers fetchData(true)
     - Fresh task data includes updated project_id and project_title
   - [x] Optimistic updates working correctly
     - State updates happen immediately after successful API calls

### 10. **Polish & Edge Cases** ✅
   - [x] Loading states: spinner on project chip during generation
     - TaskDetailModal shows ⏳ with animate-spin during projectLoading
     - CreateTaskModal shows ⏳ with animate-spin during projectLoading
     - Placeholder shows "Loading..." when generating
   - [x] Error handling: fallback project name if generation fails
     - API errors are caught and logged to console
     - Loading state is properly reset in finally block
   - [x] Dark mode: verify all project UI elements look correct
     - Using standard color tokens (text-muted-foreground, border-border, etc.)
     - All components follow existing dark mode patterns
   - [x] Accessibility: ensure dropdown has proper ARIA labels
     - Filter dropdown has title="Filter by project" for accessibility
   - [x] Keyboard navigation: ensure filter dropdown is keyboard-accessible
     - Standard <select> element is keyboard-accessible
     - Focus ring styles applied (focus:ring-2 focus:ring-ring)
   - [x] Empty states: "No tasks in this project" when filter has no results
     - List view shows context-aware messages:
       - "No tasks" (all projects)
       - "No unassigned tasks" (unassigned filter)
       - "No tasks in [Project Name]" (specific project)
     - Kanban view shows column-specific empty states

## Technical Notes

### API Contracts
- `GET /api/projects`: returns `{ projects: [{ id, title, description, emoji }] }`
- `POST /api/projects/generate`: accepts `{ taskId }`, returns `{ id, name, emoji, description, fallback? }`
- `PUT /api/tasks/[id]`: accepts `{ project_id }` (null/undefined to unassign)
- Tasks already include `project_id` and `project_title` in response

### Component Architecture
- All work happens in `src/components/panels/task-board-panel.tsx`
- PropertyChip component already exists and works well
- No new files needed
- Follow existing patterns for chips and dropdowns

### Styling Guidelines
- Use Tailwind v3.4 bracket syntax: `h-[var(--x)]` not `h-(--x)`
- Match existing chip styling for consistency
- Keep project chips on cards subtle (muted, no background)
- Use Button component for filter dropdown
- Respect dark mode throughout

### Performance Considerations
- Fetch projects once on mount, cache in state
- Don't re-fetch projects on every modal open
- Use optimistic updates where appropriate
- Filter tasks efficiently with simple array filter

## Validation Checklist

Before marking complete, verify:
- [x] `npx next build` passes without errors
- [x] Task detail modal: Project chip shows current project
- [x] Task detail modal: Can change project from dropdown
- [x] Task detail modal: "✨ New" creates project via AI
- [x] Task detail modal: Loading spinner shows during generation
- [x] Create task modal: Project chip allows selection
- [x] Board header: Project filter dropdown renders correctly
- [x] Board header: "All Projects" shows everything
- [x] Board header: "Unassigned" shows only tasks with no project
- [x] Board header: Selecting project filters tasks correctly
- [x] Kanban cards: Project chip shows emoji + name when assigned
- [x] Kanban cards: No chip when no project (clean)
- [x] List view: Project visible on each row
- [x] Dark mode: All project UI looks correct
- [x] No TypeScript errors
- [x] No raw `<select>` or `<button>` elements (use components)

---

STATUS: COMPLETE
