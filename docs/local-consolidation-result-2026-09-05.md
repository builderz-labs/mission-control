# Local Mission Control consolidation — 2026-09-05

## Result

The repositories serve one product and are consolidated in `~/Dev/mission-control`.
The web application stays at the root; the native client is `apps/desktop`, managed
by the root pnpm workspace and lockfile. Local main was fast-forwarded to `d389124`.
All 30 unrelated dirty tracked files retained their exact pre-promotion hashes;
five existing stashes remain. Nothing was published to the public GitHub fork.

The native app now uses the existing backend on `http://127.0.0.1:3000`. Its former
second backend on port 18791 has been stopped. The package carries no Next.js
server, separate Node server runtime, SQLite database, `.env`, or stored credentials.
It uses ordinary backend login, an in-memory session per full origin, and request
hooks that keep cookies out of other services, including gateway WebSockets.
Quitting the native app clears its session; Codex Preview has its own browser session.

## Preservation and integration

- All six original desktop commits remain reachable through a nonsquashed subtree
  import. Commit `81f9ca2` preserves its previously uncommitted bundled-app work.
- Both verified Git bundles, working-file archives, patches, stash listings, hashes
  and private online database backups are in
  `/Users/tylerdevries/_quarantine-2026-09-05/mission-control-preservation-20260905-115905`.
- The preservation tag was pushed to that directory's offline bare Git archive.
- Original desktop checkout moved intact to
  `/Users/tylerdevries/_quarantine-2026-09-05/mission-control-desktop`; its HEAD,
  status and all 20 original source-file hashes were verified before the move.
- The new app and ZIP are installed under `~/Applications`. The old app is retained
  as `Mission Control.app.backup-948f55b3-50f9-42c5-99aa-1cf527602679`; the old ZIP
  is in the private preservation directory.
- Fleet project **16**, workspace **1**, keeps slug `mission-control-desktop`,
  prefix `MCDT`, task IDs and crew assignments. Only its generated path changed.
- Nine local helper/generated-reference files were updated after checking their
  original hashes. Exact originals are in the preservation directory.

## Verification

| Check | Result |
| --- | --- |
| Desktop tests, Node 24.16.0 | 35 passed |
| Independent normal review | Approved final `d389124`; independently 35/35 tests |
| Independent adversarial review | Accepted final `d389124`; no remaining source security blockers |
| Real Electron 44.2.0 packaging | Staged app, strict signature, architecture, payload boundary and ZIP checks passed |
| Installation and recovery | Prior app preserved; fixture tests cover rollback and unchanged-app reuse |
| Fleet relocation tests | 6 passed across 2 test files |
| External helper tests | 2 passed |
| Web typecheck and lint | Passed; lint had zero warnings |
| Production web build and artifact boundary | Passed in isolated integration worktree |
| Targeted browser tests | 39/41 initially; missing Chromium blocked 2 cases; browser installed and all 5 login cases passed on rerun |
| Web tests on Node 24.16.0 | 1,930 passed; 1 existing scheduler source-string assertion failed |
| Live database | Online backups made; quick_check passed; project relationships unchanged |

The isolated web checks included a recorded copy of existing uncommitted web work,
so the prospective working state was checked without committing that work. The one
remaining assertion is in `workspace-isolation-enforcement.test.ts:304`, comparing
an exact SQL string in the unrelated dirty task-dispatch implementation. Initial
password-test timeouts passed on rerun and in the bounded Node24 full-suite run.

The adversarial review's alternate TMPDIR-inside-repository run passed 34/35 tests:
one packaged-config fixture unintentionally discovers its real repository ancestor.
The normal outside-repository temporary directory passes all 35 tests. This is a
fixture portability limitation, not an installed-app path failure.

## Remaining host/runtime findings

The existing Fly work changed the shared scheduler tick from 60 to 15 seconds;
scan/sync/cleanup jobs still inherit that interval. This causes four times the
intended scan cadence. High host swap and concurrent development processes further
increase I/O delays; a public health request took 25.9 seconds during verification.
Separate the reconciliation tick from the original job intervals in the Fly work.
Existing duplicate-agent sync errors and missing workspace TOOLS.md files also remain.

Automatic Mac cleanup removed active temporary review logs, app build caches and
the Corepack pnpm runtime during this task. Corepack was restored and the final
validated app artifacts rebuilt in the private preservation directory. Cleanup
needs to exclude active runtime and build directories. Native UI screenshot capture
also failed after cache removal; do not treat an unobserved native screen as verified.

The shared standalone runtime's optional WebSocket bufferutil failed repeatedly.
The local LaunchAgent start helper now sets `WS_NO_BUFFER_UTIL=1`, using the library's
JavaScript fallback. Its original helper is preserved. The existing web build and
unrelated working files were not replaced during these service restarts.

Dependency audit after upgrading Electron reports **8 high and 6 moderate** existing
web dependency advisories, with no remaining Electron-chain advisory in that audit.
These remain a separate web dependency maintenance task.

Claude architectural assessment was unavailable on three bounded attempts. Initial
Codex reviews found issues that were repaired; when cache deletion broke the final
companion transport, two independent direct Codex reviews completed and accepted the
actual final source. Claude acceptance is not claimed.

## Runtime completion

All four temporarily paused background-job settings were restored to their exact
original values; dispatch and Fly reconciliation were never paused. Fifty-four
completed helper processes belonging only to this task were stopped.

The app is installed and launches, and port 18791 remains closed. Codex Preview
was opened at the canonical URL, but final navigation was not verified: the
shared backend intermittently takes 10–30+ seconds or times out, and the native
UI capture tool fails to create its screenshot destination after cache removal.
This host/runtime limitation remains; a successful final interactive smoke test
is not claimed. The source consolidation and validated installation are complete.
