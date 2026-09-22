# Mission Control local repository audit

Date: 2026-09-05. Decision owner: Tyler DeVries. Status: recommendation; repository consolidation has not been performed.

## Decision

Consolidate the desktop source into `mission-control/apps/desktop` when the current work is preserved and ready for integration. Keep the web application at the repository root to minimize disruption to upstream merges, deployment scripts, and local integrations. Retain the desktop wrapper as a distinct package and build target.

These are complementary applications, not duplicate clones. Keeping separate Git repositories is optional; keeping the desktop functionality is necessary if the native macOS app remains useful. Neither folder is safe to delete as a duplicate today.

The more significant consolidation opportunity is runtime ownership: use one local backend and database for the browser and desktop window. Preserve an explicit standalone desktop mode only if portable/offline distribution is needed; it should have a deliberate data-directory policy and avoid silently sharing a live database with another backend.

## Scope and evidence

Inspected Git history, branches, remotes, worktrees, stashes, dirty/untracked work, source manifests, desktop implementation and tests, build/launch scripts, installed app and ZIP, LaunchAgent configuration, process working directories, native dependencies, artifact boundaries, database metadata, HTTP responses, and Codex Preview behavior.

Repository discovery covered common development/document directories, Codex worktrees, and saved Codex projects. It identified these two relevant source repositories. Installed application bundles and archives are separate deployment artifacts.

| Property | Web/backend | Desktop wrapper |
| --- | --- | --- |
| Location | `/Users/tylerdevries/Dev/mission-control` | `/Users/tylerdevries/Dev/mission-control-desktop` |
| Product | Next.js 16 / React 19 / SQLite dashboard, API, orchestration | Electron native window, login integration, server packaging/lifecycle |
| Package | `mission-control` 2.3.0 | `mission-control-desktop` 1.0.0, private |
| Git HEAD | `acee1364524b1b015d50760c34a516aaf73aa4e4` | `e6a0f21877021f9cb7ba00086266f673efbf78fe` |
| Branch | `main`, tracks `fork/main` | `main`, no tracking remote |
| Commits reachable from HEAD | 553 | 6 |
| Tracked files | 1,089 | 16 |
| Tracked file bytes | 13,364,715 | 49,380 |
| Initial modified tracked files | 30 | 4 |
| Initial untracked files | 31 | 4 |
| Stashes | 5 | 0 |
| Registered Git worktrees | One | One |
| Remotes | Builderz upstream `origin`; Tyler's fork `fork` | None |
| Approximate allocated disk | 4.2 GB | 233 MB |

The repositories share **zero reachable commit IDs**. The only shared tracked relative filenames are `.gitignore`, `AGENTS.md`, `CLAUDE.md`, and `package.json`; there is no second copy of the web source tree in the desktop checkout.

Web `main` has no commits absent from the locally stored remote refs. This is a local-ref observation, not a fresh verification of GitHub state. All six desktop commits are local-only with respect to configured Git remotes. The desktop history and its current untracked server implementation must be preserved before retirement of that repository.

Web stashes contain chat UI, fleet, and mac-cleanup work. Current web changes include Fly orchestration and runtime fixes; desktop changes implement bundled-server startup and the immediate loading shell. Files continued changing during the audit, so counts and test results are snapshots rather than a frozen integration baseline.

## How the two applications connect

1. The web repository builds `.next/standalone`.
2. Desktop `scripts/bundle-ui.sh` copies that output, static files, public assets, translations, and a Node executable into the installed application.
3. Desktop `src/main.mjs` creates the Electron window, starts/reuses a backend, and uses existing local credentials for login.
4. Desktop `src/bundled-server.mjs` normally uses port 18791 and prefers the web checkout's `.data` and `.env` paths.
5. The LaunchAgent runs the web standalone service on port 3000 through `/Users/tylerdevries/.agents/scripts/mission-control-start.sh`.

At inspection, port 3000 was owned by PID 3526, working in the web standalone directory. Port 18791 was owned by PID 80223, working inside `/Users/tylerdevries/Applications/Mission Control.app/Contents/Resources/app/server`. The first listener binds all interfaces; the desktop listener binds loopback.

The desktop process had the web checkout's SQLite database open. After the web runtime repair, both processes were confirmed to have that same database open. No second database was found at the inspected standalone or Application Support fallback locations.

The database passed a read-only SQLite `quick_check`. Initial metadata: 64 tables, 58 migration records, 19 tasks, 22 agents, 23 projects, one workspace, and one user. No database records or credential values are reproduced here.

## Findings

### High: the desktop repository is not backed by a Git remote

Deleting it loses its unique six-commit history and current changes. Four tracked files were modified; four untracked files included the bundled-server implementation, its tests, packaging script, and loading shell. Importing only committed HEAD would omit behavior already present in the installed application.

Action: preserve refs/history, stashes where applicable, and uncommitted/untracked work separately before any move. A Git bundle alone does not capture dirty files. Inspect ignored files for user data before archiving an old checkout.

### High: two backend processes can run background jobs against one database

Desktop `src/bundled-server.mjs:34` explicitly prefers the web checkout's `.data`. Web `src/lib/db.ts:83` initializes the scheduler for each runtime process; `src/lib/scheduler.ts:315` guards initialization with a process-local variable. This provides no cross-process singleton guarantee for the scheduler as a whole.

This is a duplicate-work and version-skew risk, not evidence that corruption or duplicate dispatch has already occurred. SQLite WAL coordinates database access but does not by itself elect a single background-job owner. Some jobs may have their own claim/lease protections; that does not make the entire scheduler a singleton.

Action: make the local desktop window use the canonical backend, or define a separately managed portable mode with isolated data and deliberate lifecycle ownership. Do not combine databases by copying files over a running database.

### High: incompatible native SQLite binaries prevented web startup

Before repair, `/health` on port 3000 returned HTTP 503 with database error. Direct in-memory checks showed that `better_sqlite3.node` was compiled for Node ABI 147, while the configured Node 24.16.0 requires ABI 137. The source, standalone, and installed-app binaries initially had identical hashes.

Repair performed for the requested Preview launch: backed up source/standalone native binaries, ran `pnpm rebuild better-sqlite3`, verified an in-memory database, and atomically replaced only the web standalone SQLite binary. The existing service recovered without a process restart. Health then returned HTTP 200 with `status: ok` and `db: ok`.

The installed desktop app and ZIP were not rebuilt. Their native binary still requires correction before relying on a fresh desktop launch with the bundled Node 24 runtime. Pin the build/runtime Node version and smoke-test native modules inside the final packaged artifact.

### Medium: the desktop service serves an invalid JavaScript response

Codex Preview encountered `ChunkLoadError` at the desktop login. A direct check of `/_next/static/chunks/1287-aa685914da898a37.js` returned HTTP 200 but `text/html`, with 101,196 bytes. The corresponding file is 10,794 bytes of JavaScript. The web service returned the correct JavaScript and matching file contents.

Both on-disk bundles report build ID `EdLCfGBy2bGJ8OJrJvDrq`, and all inspected installed desktop source files match the desktop checkout. Thus matching build IDs/source copies do not prove that a long-running packaged service serves a coherent artifact. The exact cause of the desktop response mismatch remains unconfirmed.

Action: verify HTML and dependent assets, including content types, against the final running package. Rebuild/restart the desktop artifact as a separate controlled repair; do not use its current health response as proof that the UI works.

### Medium: packaging accepts implicit build sources and fails artifact policy

Desktop `scripts/bundle-ui.sh:6` and `scripts/build-app.sh:6` prefer a hidden `.claude/worktrees/desktop-bundle` artifact when present. That worktree/artifact is currently absent, but its future presence can silently change which UI ships. Desktop packaging copies the entire selected standalone tree and does not invoke the web artifact boundary check.

`pnpm artifact:check` currently fails because `.env` is included in the standalone root. The installed app and ZIP also contain that file. Its inspected keys are only `MC_ALLOWED_HOSTS`, `MC_ENABLE_HSTS`, and `MC_COOKIE_SECURE`; no `AUTH_PASS`, `AUTH_SECRET`, or `API_KEY` was present. This is a packaging-policy failure, not a confirmed credential leak.

Action: choose the artifact explicitly, record its revision/build/runtime identity, and enforce the existing boundary check before packaging. Keep runtime configuration external to distributable artifacts.

### Medium: moving the desktop folder requires integration updates

Hard-coded desktop paths appear in desktop `src/app-paths.mjs`, `bin/open-mission-control`, web `src/lib/fleet-projects.ts:27`, `/Users/tylerdevries/.agents/scripts/fleet-heal.sh`, and `/Users/tylerdevries/.agents/scripts/openclaw-workspaces-lib.mjs`.

Desktop auth/server code also relies on the canonical web checkout path. The server supports an Application Support `.env` fallback, while `src/auto-login.mjs:8` still defaults to the web checkout `.env`; portable deployment therefore has inconsistent login-path handling.

Action: replace relocation-sensitive paths with explicit settings or paths derived from the package location. Preserve existing fleet project/task associations while updating their path; avoid deleting/reseeding project records simply to rename a checkout.

### Low: repository consolidation offers little immediate disk savings

Web disk usage is approximately 3.1 GB `.next`, 1.0 GB `node_modules`, 40 MB runtime data, and 16 MB Git history. Almost all desktop checkout disk usage is its 233 MB dependency/runtime installation. The installed app is another 428 MB; its ZIP is 168,119,688 bytes.

Moving roughly 49 KB of tracked desktop files does not eliminate Electron, a runnable app bundle, or web build artifacts. Treat artifact/cache retention separately, and do not remove live build files or runtime data as part of a folder deduplication operation.

## Alternatives and consequences

| Alternative | Assessment |
| --- | --- |
| Keep separate repositories | Valid if desktop has independent ownership/releases. Requires a remote backup and explicit artifact contract. Current code is tightly coupled to local web paths, so separation supplies limited architectural isolation. |
| Import desktop into `apps/desktop` | Recommended. One review/build history and shared Node/package-manager policy, while keeping web-root layout and desktop package boundaries. Requires path fixes and careful history/WIP preservation. |
| Delete desktop and use Codex Preview/browser only | Reasonable only if native window, app bundle, and portable desktop delivery are intentionally retired. Archive its unique history/work first. |
| Merge/copy both folders wholesale | Reject. Mixes independent Git histories, generated binaries, dependencies, and runtime state without resolving the actual coupling. |

## Concrete consolidation sequence

1. Record a stable baseline in both repos, including all branches, five web stashes, desktop commits, dirty files, and untracked files. Take an online SQLite backup and store secrets privately outside source control.
2. Prepare an isolated integration branch from the web fork. Import desktop history under `apps/desktop` without squashing away provenance; carry its current working changes in a separate reviewable commit.
3. Retain the root Next.js layout. Add `apps/desktop` to pnpm workspace packages, pin a common pnpm/Node version, and convert the desktop lockfile deliberately. Avoid copying `node_modules`, `.next`, `.env`, `.data`, application bundles, or ZIPs into Git.
4. Update launchers, package path resolution, fleet definitions/tests, and external helper scripts. Preserve project IDs and existing task associations. Use a temporary compatibility path only if necessary, with a documented retirement step.
5. Make desktop packaging consume an explicit validated standalone artifact. Add native ABI, forbidden-file, health, login, JavaScript/CSS response, launch/quit, and data-path checks.
6. Select one backend owner for ordinary local use. Keep portable mode explicit; verify shared browser/desktop views without running unintended duplicate schedulers.
7. Run integration gates, review the actual import and path changes independently, and verify the installed app plus Codex Preview. Archive the old checkout only after the replacement works and all unique work is accounted for.

No consolidation, branch switch, commit, push, repository deletion, database relocation, LaunchAgent reconfiguration, or desktop restart was performed during this audit.

## Verification and delivered state

| Check | Result |
| --- | --- |
| Desktop `pnpm test` | 23 tests passed |
| Web `pnpm typecheck` | Passed |
| Web `pnpm lint` | Passed, no linter warnings |
| Initial web `pnpm test` | 257 files passed; 19 files failed from the native SQLite mismatch. 1,847 tests passed, 66 failed, 16 skipped; one suite failed before collection. |
| Rerun all 19 failed files after native repair | 19 files / 97 tests passed |
| Web `pnpm artifact:check` | Failed: forbidden `.env` in existing artifact; recorded above |
| SQLite read-only integrity check | `quick_check: ok` |
| Web HTTP and browser verification | Health 200; correct JavaScript bytes/content type; successful normal login; dashboard rendered in Codex Preview |
| Full rebuild / automated E2E | Not run: this audit used the existing production artifact; rebuilding in place would replace live build output from a dirty, changing checkout |

Test results combine the initial full run and the focused post-repair rerun, not a second clean full-suite run. The native dependency installer emitted a dependency deprecation warning; source lint remained clean. No application source was modified by this audit.

Codex Preview is left open at `http://127.0.0.1:3000/`. The desktop server remains at port 18791 with the recorded artifact issues. Native-binary backup location is recorded in `.adaptive-context/runtime-audit-backup.json`. Test logs are `/tmp/mission-control-repo-audit-tests.log` and `/tmp/mission-control-repo-audit-retest.log`.

Ruflo guidance was compiled/retrieved locally; it produced zero rules because the root guidance is an `@AGENTS.md` reference. The ADR workflow supplied the decision structure. Adaptive-context policy/recovery metadata were updated. Audit and verification stayed local because the checkouts were dirty and the runtime/installed-app inspection was macOS-specific. Integration review gates apply to the future consolidation; no integration diff was created here.
