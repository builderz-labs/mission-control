Read @AGENTS.md for project conventions and commands.
Read `specs/xfeed-redesign.md` for the full requirements.

Create an IMPLEMENTATION_PLAN.md with numbered tasks to implement this spec.
Each task should be small, focused, and independently testable.
Order tasks by dependency (foundational changes first).

Key constraints:
- Tailwind v3.4 (bracket syntax: `h-[var(--name)]` not `h-(--name)`)
- Use `<Button>` component for ALL buttons (never raw `<button>`)
- Use `PropertyChip` for ALL filter dropdowns (never raw `<select>`)
- Use project's `Tabs` component for the Curated/All toggle
- Check `src/components/ui/` for existing components before creating anything
- Dark mode is primary — test dark mode first
