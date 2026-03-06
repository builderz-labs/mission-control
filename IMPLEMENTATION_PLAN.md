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

### 7. **Add Project Chips to Kanban Cards**
   - Location: in `renderCard()` function, after title, before chips row (line 516-519)
   - Only render if `task.project_id` exists (don't show "No project")
   - Component: simple styled div, NOT PropertyChip
   - Styling: `text-xs text-muted-foreground flex items-center gap-1 mt-1.5`
   - Content: `{task.project_title && <span>{projectEmoji} {task.project_title}</span>}`
   - Need to get emoji from projects array by matching project_id
   - Keep it subtle: no background, muted text

### 8. **Add Project to List View Rows**
   - Location: in list row rendering, after assignee chip (line 679-700)
   - Same approach as kanban cards: only show if project exists
   - Display: small chip with emoji + name
   - Styling: same as kanban, subtle and muted

### 9. **Handle Project Updates from API**
   - Ensure `fetchData()` updates keep selectedTask in sync
   - When project is assigned via generate API, task should reflect it
   - Consider optimistic updates for better UX

### 10. **Polish & Edge Cases**
   - Loading states: spinner on project chip during generation
   - Error handling: fallback project name if generation fails
   - Dark mode: verify all project UI elements look correct
   - Accessibility: ensure dropdown has proper ARIA labels
   - Keyboard navigation: ensure filter dropdown is keyboard-accessible
   - Empty states: "No tasks in this project" when filter has no results

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
- [ ] `npx next build` passes without errors
- [ ] Task detail modal: Project chip shows current project
- [ ] Task detail modal: Can change project from dropdown
- [ ] Task detail modal: "✨ New" creates project via AI
- [ ] Task detail modal: Loading spinner shows during generation
- [ ] Create task modal: Project chip allows selection
- [ ] Board header: Project filter dropdown renders correctly
- [ ] Board header: "All Projects" shows everything
- [ ] Board header: "Unassigned" shows only tasks with no project
- [ ] Board header: Selecting project filters tasks correctly
- [ ] Kanban cards: Project chip shows emoji + name when assigned
- [ ] Kanban cards: No chip when no project (clean)
- [ ] List view: Project visible on each row
- [ ] Dark mode: All project UI looks correct
- [ ] No TypeScript errors
- [ ] No raw `<select>` or `<button>` elements (use components)

---

STATUS: PLANNING_COMPLETE
