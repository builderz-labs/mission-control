Read @AGENTS.md for project conventions and commands.
Read `specs/projects-panel-sidebar.md` to learn the specifications and ACCEPTANCE CRITERIA.
Read @IMPLEMENTATION_PLAN.md and choose the most important remaining item.

Before starting, check your available skills — use any that are relevant.
Before making changes, search the codebase — don't assume not implemented.
Before creating ANY UI element, check `src/components/ui/` for existing components. ALWAYS use existing components over raw HTML elements.

Implement ONE item. Then validate:
1. Run `npx next build` — must pass with zero errors
2. Verify your changes match the acceptance criteria in the spec

If build passes: update @IMPLEMENTATION_PLAN.md (mark item done with [x]), commit with clear message, update STATUS.md with what you did.
If build fails: fix until it passes. If same error appears twice, write CRITICAL BLOCKER in STATUS.md and stop.

When ALL items in IMPLEMENTATION_PLAN.md are complete AND all acceptance criteria met:
Add to IMPLEMENTATION_PLAN.md: STATUS: COMPLETE
