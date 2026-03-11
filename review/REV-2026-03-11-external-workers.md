# REV Review — External Workers / GitHub Workflow

## Scope reviewed
- external worker registry + scheduler integration
- worker spawn / babysit / steer scripts
- API surface for workers
- docs added for operator usage

## Findings
- **Pass with notes**

### Notes
1. The initial spawn wrapper had a multiline prompt quoting bug. This was diagnosed and corrected before final run.
2. The babysitter had an exited+done-gate classification bug. This was corrected so passed done-gates become `done`.
3. The current shell-script path is functional, but the TypeScript CLI wrapper still needs cleanup for standalone runtime use outside Next module resolution.

## Evidence checked
- successful real worker run
- done gate artifact present
- terminal log present
- `pnpm typecheck` passed

## Gate recommendation
- pass-with-notes

## Required follow-up
- harden the non-Next standalone wrapper path
- optionally add richer CI/test marker detection beyond done gate text matching
