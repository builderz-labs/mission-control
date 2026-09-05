# Desktop consolidation

The native macOS app is the `mission-control-desktop` pnpm workspace package at
`apps/desktop`. The Next.js application remains at the repository root.

## Runtime ownership

The browser and native window use the same backend at `http://127.0.0.1:3000`.
The desktop app is a client: it does not ship Next.js, SQLite, a Node executable,
credentials, or runtime data. The existing local service owns its database and
background scheduler. Closing the window does not stop that shared service.

The previous app ran a second backend on port 18791 against the web checkout's
database. That behavior is retired. Portable distribution of a complete backend
would require a separate design for data isolation, configuration, versioned
artifacts, and lifecycle ownership; it is not an implicit fallback.

The app uses a validated loopback origin for health, login, and navigation.
See `apps/desktop/README.md` for exact supported configuration and packaging
options. Local runtime credentials remain in the canonical checkout's `.env`.

## Development

Use the Node version in `.nvmrc` and the root `packageManager` pnpm version.

```bash
pnpm install --frozen-lockfile
pnpm test:desktop
pnpm desktop:build
pnpm desktop:start
```

The production backend must be available. On the original host, the LaunchAgent
`com.tylerdevries.mission-control` owns it. Other hosts can start the root
production standalone build themselves. A missing/unhealthy service must produce
a useful local error, rather than starting a second database-owning server.

## History and local data

All six original desktop commits were imported without squashing through a Git
subtree merge. Commit `81f9ca2` additionally preserves the desktop checkout's
previous uncommitted bundled-app work. The historical design is recoverable from
Git even though it is removed from the active package.

Before integration, both repositories were backed up as verified Git bundles,
working-file archives, binary diffs, stash listings, and a private online SQLite
backup. The desktop preservation tag was pushed to an offline bare Git archive
outside the source checkouts. No publication to the public GitHub fork is needed
to preserve that local history.

The old desktop checkout can be moved intact to a dated quarantine directory only
after the replacement package, installed app, and shared backend are verified.
Do not recursively delete it, discard its history, or copy its dependencies and
generated application bundles into source control.

The fleet project keeps its `mission-control-desktop` slug and `MCDT` prefix.
Seeding updates only a description that exactly matches the former generated
checkout path, scoped to its workspace. Custom descriptions, project IDs, tasks,
and crew assignments remain unchanged. Operational helper scripts and generated
fleet references must point at `~/Dev/mission-control/apps/desktop`.

## Validation

The quality gate includes desktop tests in addition to the web unit tests,
typecheck, lint, build, artifact checks, and E2E suite. macOS packaging must also
be verified against a staged destination before replacing the installed app.
Installation must preserve the previous application for rollback.

Source-control consolidation does not automatically free Electron's runtime or
web build caches. Treat those artifacts separately from history and live data.
