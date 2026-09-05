# Mission Control desktop

A lightweight native macOS window for the canonical Mission Control web checkout.
It paints a dark shell immediately, waits for the existing backend, signs in with
normal local credentials when available, and opens the dashboard. It contains no
backend, standalone Next.js output, Node server runtime or database.

The default backend is **http://127.0.0.1:3000**. A healthy shared service is reused.
When that exact origin is unavailable after retries, the app may invoke
`launchctl kickstart gui/<uid>/com.tylerdevries.mission-control` once, without `-k`.
Alternate origins never trigger service management. Closing the app leaves the
backend running.

## Development

Use Node >=22 and `pnpm@10.29.3`. The root owner manages workspace registration and
`pnpm-lock.yaml`. Install dependencies with pnpm after that integration; installation
must succeed and Electron's normal install script must be allowed by parent pnpm
policy. The desktop has no postinstall runtime extraction or cached-runtime fallback.

```sh
pnpm --dir apps/desktop test
pnpm --dir apps/desktop start
pnpm --dir apps/desktop build --stage-only --output /absolute/path/to/artifacts
```

Electron is pinned to `38.8.6` and resolved from this package's installed dependency,
including pnpm's symlinked location. Missing or mismatched installations fail the build.
The source and build paths are discovered relative to this package, independent of cwd.

## Local configuration and authentication

- `MISSION_CONTROL_ROOT`: absolute canonical web checkout path. By default, source
  runs find the repository and resolve Git's common checkout for worktrees. Packaged
  builds record that canonical path as non-secret metadata. The conventional
  `~/Dev/mission-control` is the fallback for an unpackaged copy with no repository.
- `MC_DESKTOP_ENV_FILE`: optional absolute credentials file, default `<root>/.env`.
  Reads `AUTH_USER` and `AUTH_PASS` (or `AUTH_PASS_B64`). Credentials are never bundled.
- `MC_DESKTOP_URL`: optional loopback HTTP origin with an explicit port, such as
  `http://127.0.0.1:3100`, `http://localhost:3100`, or `http://[::1]:3100`.
  Ports must be 1024–65535; Chromium-blocked ports and port 4190 are refused. Other origins,
  userinfo, numeric host aliases, paths, queries and fragments are rejected. An
  optional trailing root slash is accepted.

Health and credential-free login probes reject redirects before reading `.env`.
The login POST also refuses redirects and never forwards credentials to a redirect
location. Requests have a three-second timeout including body consumption and one
retry for transport/timeouts or HTTP 408/500/502/503/504. Authentication failures
and rate limits are not retried. Missing credentials or failed login lead to the
ordinary local login page. Cookies retain Secure; failed cookie installation is
never retried with weaker attributes. This app neither bypasses setup nor seeds users.

The window uses Electron sandbox and context isolation with Node integration off.
Navigation is limited to the selected origin; all popups and navigation redirects
are blocked. A single-instance lock focuses the existing window on a second launch.

## Packaging and parent installation

Builds require macOS signing/archiving tools. Default output is a new temporary
artifact directory, or set `--output /absolute/path` / `MC_DESKTOP_OUTPUT`.
Each fingerprint directory contains `Mission Control.app`, `Mission Control.zip`
and an archive digest manifest. The app payload contains only package metadata,
production source and non-secret desktop/build metadata. Tests, dependency trees,
backend/runtime output, `.env` and `.data` are rejected at the app payload boundary.

Fingerprints include every shipped byte, all build scripts/launcher files, Electron
version, host architecture, canonical root and signing identity. A cache hit requires
matching payload bytes, valid bundle identity/Electron version/architecture/signature,
and the archive digest. Corrupt outputs are preserved and rejected; choose a fresh
output directory to rebuild. Staging is temporary and published only after validation,
signing and archive verification. Fingerprints are deterministic; signatures and zip
metadata are not promised to be byte-for-byte reproducible between machines.

The parent can separately install using `--install-to /absolute/Mission\ Control.app`
or `MISSION_CONTROL_APP`. A validated candidate is copied beside the destination;
renames publish it and retain the old app as `.backup-<uuid>`. Failed publication
restores the old app; a failed rollback retains the backup and candidate for recovery.
An exclusive installation lock prevents concurrent replacements. A process crash may
leave that lock for the parent to inspect and remove before another installation.
Signing failures stop the build. Quarantine is never modified. `--stage-only` refuses
installation settings. Default signing is ad-hoc; `MC_DESKTOP_SIGN_IDENTITY` selects
another identity. Notarization/distribution signing belongs to the parent.

For an explicitly authorized staged build only, the parent may pass
`--electron-package /absolute/path/to/node_modules/electron` (or
`MC_DESKTOP_ELECTRON_PACKAGE`). This reads the specified installed Electron package
and verifies both package and distribution versions; it never modifies that tree.
No arbitrary cache or installed application is selected as a runtime source.

All tests use temporary fixtures and mocked requests/LaunchAgent calls; they do not
read production credentials/databases or mutate live services. Full root lint,
integration, independent review, installation and quarantine handling belong to the parent.
