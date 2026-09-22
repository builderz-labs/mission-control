# Mission Control production audit

Date: 2026-09-06  
Audit branch: `codex/ui-ux-production-audit`  
Audited revision: `661a1b3a4c205478c1e664561caa55d15dbf5c5b` plus the changes in this worktree  
Audit runtime: `http://127.0.0.1:3100` with an isolated data directory

## Decision

Mission Control should remain one repository. The local filesystem contains one canonical repository at `/Users/tylerdevries/Dev/mission-control`. The apparent duplicates are Git worktrees of that repository, including active desktop-consolidation and audit branches. The native desktop package already lives in `apps/desktop`; no separate `mission-control-desktop` checkout exists under `/Users/tylerdevries/Dev`.

Keep active worktrees until their owners finish or integrate them. Two temporary worktree records are prunable because their directories no longer exist. Pruning those records is housekeeping and does not change the product architecture.

## Production-readiness decision

The current tree is **not ready for a production-readiness sign-off**. The browser audit and critical interactive flows pass, and the highest-impact defects found in this audit have fixes in the audit worktree. The mandatory release gates, dependency vulnerability scan, and formal browser performance trace have not run on this final tree. The project policy requires those checks to run through Mission Control Fly when disk is below 50 GB or the Fly offload marker exists; both conditions are present, while `mc_submit_fly_leaf` is unavailable in this task environment.

## Scope and method

- Inspected 31 primary product routes plus legacy aliases, the login surface, and an invalid route.
- Exercised the app at 390x844, 768x1024, 1280x800, and 1440x900.
- Checked navigation, responsive layout, heading structure, focus behavior, dialog semantics, loading states, error recovery, and horizontal overflow.
- Created a task through the UI in an isolated audit database.
- Switched from Essential mode to Full mode through the UI and exercised the gateway configuration editor.
- Reviewed API authorization boundaries, rate limiting, security headers, external network calls, desktop navigation policy, and data/error handling.
- Reviewed repository topology, desktop packaging, deployment configuration, source size, and TypeScript escape hatches.
- Applied `ui-ux-pro-max` and `dashboard` as implementation guides. The desktop app is Electron/React rather than SwiftUI, so SwiftUI UI Patterns and Liquid Glass were used as interaction and visual-review criteria, not as implementation frameworks.

## Apple design criteria

The changes follow Apple's current guidance in the areas that map cleanly to this web/Electron app:

- [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars): keep navigation hierarchy shallow, collapse it in compact layouts, and preserve the user's current location.
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars): group actions, avoid crowding, and keep controls legible in resizable windows.
- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/): support resizable windows, keyboard interaction, and an information density suited to a desktop workspace.
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): provide explicit labels and actions, support larger targets on touch devices, and avoid relying on color alone.
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) and [Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass): reserve translucent material for navigation and controls, keep content surfaces readable, and respect contrast/transparency needs.
- [Windows](https://developer.apple.com/design/human-interface-guidelines/windows): use sensible initial and minimum window geometry and reveal content only when it is ready.

## Findings and changes

| Severity | Finding | Result |
| --- | --- | --- |
| High | Login rate limiting trusted a client-controlled `X-Real-IP` header even when no trusted proxy was configured. An attacker could rotate the header to evade the limiter. | Fixed. Forwarded identity is used only when `MC_TRUSTED_PROXIES` is configured; audit logging now uses the same trusted extraction path. |
| High | The Gateway Configuration page retained a fixed 208 px rail at 390 px width, leaving about 182 px for the editor. | Fixed. Compact layout stacks the controls, uses a section selector, wraps actions, and gives the editor the full viewport width. |
| High | Required release gates cannot run under the repository's Fly routing policy because the Mission Control Fly submission tool is unavailable. | Open release blocker. Do not promote until lint, typecheck, unit tests, build, and the relevant browser suite pass on the final revision. |
| Medium | Session loading requested `limit=all` and rendered the entire result set on the Overview page. | Fixed. The API uses its bounded default, the client has a 15-second deadline, and the widget initially renders at most 40 rows with progressive disclosure. |
| Medium | Several legacy URLs produced inconsistent state or blank/unknown panels. | Fixed. `sessions`, `history`, `tokens`, `agent-costs`, and `gateway-parent` resolve to canonical routes. Unknown paths render an explicit Page not found state. |
| Medium | Many panels lacked a semantic level-one heading; several failures were swallowed, leaving empty or stale UI. | Fixed across the audited panels. Overview also describes its purpose, and dashboard failures expose a retry action. |
| Medium | The compact navigation sheet lacked dialog semantics, focus containment, Escape handling, and focus restoration. | Fixed and verified with keyboard interaction at 390 px. |
| Medium | The Electron shell denied all new-window requests, so safe external documentation links could not open. | Fixed. HTTPS links without credentials open in the system browser; in-app popups stay denied. The window now has minimum geometry and waits for `ready-to-show`. |
| Medium | Several external API calls had no retry policy; some errors exposed raw provider or process messages. | Fixed for release checks, provider probes, Google token verification, skill registry requests, runtime security review, and direct task providers. Callers keep their explicit timeout budgets, transient failures retry once, and sensitive integration errors are generic. |
| Medium | Production CSP inherited development-only `unsafe-eval`; several baseline browser security headers were absent. | Fixed. `unsafe-eval` is development-only. Permissions Policy, cross-origin opener policy, cross-domain policy, and HTTPS-only HSTS were added. |
| Medium | The macOS system monitor used Linux-only `ps --sort`, producing errors instead of process data. | Fixed with platform-specific process collection. |
| Medium | The desktop/session UI contained hard-coded promotional content and duplicate diagnostic copy. | Fixed. Promotional cards were removed and doctor-banner messages are normalized and deduplicated. |
| Low | Controls and schema fields lacked accessible names or suitable coarse-pointer targets. | Fixed in the audited shared controls, gateway fields, header/nav actions, banners, and loaders. Coarse-pointer controls have a 44 px minimum target. |
| Low | Full-mode-only panels could render without a useful page identity or recoverable mode-switch failure. | Fixed with a shared heading, mode explanation, save feedback, and path back to Overview. |

## Browser verification

| Flow | Viewport | Result |
| --- | --- | --- |
| Primary route sweep | 1440x900 | 31 routes rendered; no document-level horizontal overflow found. Async-loading Agents and Tasks were also checked after their loaders completed. |
| Alias routing | Desktop | Legacy aliases resolved to canonical URLs. |
| Invalid route | Desktop | Explicit Page not found surface rendered. |
| Overview | 390x844, 1280x800 | Heading, responsive banners, capped session DOM, and progressive disclosure rendered correctly. |
| Task creation | 768x1024 | Labeled dialog submitted successfully; the new task appeared in the board in the isolated audit database. |
| Compact navigation | 390x844 | Dialog name exposed as Navigation, focus entered the sheet, Escape closed it, and focus returned to More. |
| Gateway mode and configuration | 390x844, 1440x900 | Essential-mode gate saved Full mode; full editor rendered without horizontal overflow. The connected backend's schema endpoint returned 502, and the fallback editor remained functional. |
| Settings and Super Admin | 1440x900 | Final async render exposes `Settings` and `Super Mission Control` level-one headings. |
| Runtime console | Desktop | No new client compile/runtime errors observed during the final sweep. Historical unauthenticated warnings remained in the tab log. |

## Performance observations

- The session widget's initial rendered session count fell from approximately 120 to 40. The observed accessibility tree dropped from roughly 169 KB/659 lines to 33 KB/120 lines.
- Warm session responses were generally between about 32 and 600 ms. One cold session sync took about 7.9 seconds because it scans local Claude state.
- The doctor endpoint took about 7.3 seconds cold and about 25 ms after caching.
- Channel requests ranged from about 0.8 to 2.3 seconds during the audit.
- A formal Lighthouse/Core Web Vitals trace is still required. The in-app Browser did not expose CDP tracing in this task, and the repository policy prevents running the Playwright leaf locally.

## Remaining production blockers

1. Run the current final revision through the required Fly release matrix: zero-warning lint, TypeScript, unit tests, production build, desktop tests, and focused browser tests.
2. Run a dependency vulnerability audit and the repository security suite on the final lockfile and revision.
3. Capture a formal performance trace for Overview, Tasks, Chat, and Gateway Configuration, including cold and warm data loads.
4. Resolve the gateway schema contract mismatch. `/api/gateway-config?action=schema` returned 502 against the connected backend; the fallback editor works, but schema-driven validation is unavailable.
5. Reduce the remaining cold sync latency or move the scan behind cached/background refresh behavior.
6. Address the source-maintainability policy before calling the entire repository compliant. Of 902 inspected TS/TSX/JS/MJS files, 166 exceed 200 lines and `rg` found 850 occurrences of `any`. The largest examples are `agent-detail-tabs.tsx` (3,020 lines), `task-board-panel.tsx` (2,598), `office-panel.tsx` (2,466), and `task-dispatch.ts` (2,303). These are pre-existing broad refactors that require isolated ownership and regression coverage.
7. Integrate only the audit-owned hunks. This worktree also contains concurrent Fly orchestration edits, so a blanket stage or merge would mix unrelated work.

## Screenshot evidence

| Surface | Before | After |
| --- | --- | --- |
| Mobile Overview | [overview-mobile-before.png](overview-mobile-before.png) | [overview-mobile-after.png](overview-mobile-after.png) |
| Mobile Gateway Configuration | [gateway-config-mobile-before.png](gateway-config-mobile-before.png) | [gateway-config-mobile-after.png](gateway-config-mobile-after.png) |
| Desktop Overview | - | [overview-desktop-after.png](overview-desktop-after.png) |
| Tablet Tasks | - | [tasks-tablet-after.png](tasks-tablet-after.png) |
| Desktop Gateway Configuration | - | [gateway-config-full-desktop-after.png](gateway-config-full-desktop-after.png) |

## Release handoff

The verified audit build remains available at `http://127.0.0.1:3100`. It uses `/private/tmp/mission-control-ui-audit-20260905`, so its UI-created task and settings do not affect the production database. The implementation is isolated on `codex/ui-ux-production-audit`; it has not been merged into the dirty main checkout.
