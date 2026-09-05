# Mission Control desktop

This package is a native Electron window onto one existing local Mission Control
backend. Default origin: `http://127.0.0.1:3000`. Never bundle or spawn a backend,
Node runtime, database, or alternate portable service.

- Package manager: `pnpm@10.29.3`; Electron must be exactly `44.2.0`.
- Manage workspace/lockfile changes and integration checks at the repository root.
- Tests: `pnpm --dir apps/desktop test` (temporary fixtures only).
- Stage: `pnpm --dir apps/desktop build --stage-only --output /absolute/output`.
- Build never installs by default. Installation needs explicit `--install-to` or
  `MISSION_CONTROL_APP`; preserve the old bundle and support rollback.
- Resolve Electron from the installed dependency, including pnpm symlinks. An
  explicit Electron package override is permitted only for staged macOS builds.
- `MISSION_CONTROL_ROOT` identifies the canonical checkout in build metadata.
  Never read credentials files or copy secrets into artifacts.
- `MC_DESKTOP_URL` accepts explicit loopback HTTP origins with safe unprivileged
  ports. Health, login and window use the same origin.
- Refuse external navigation/redirects and popups. Preserve sandbox,
  contextIsolation, disabled nodeIntegration and single-instance behavior.
- Use the ordinary login screen; never send passwords or install cookies automatically.
  Use an in-memory session partition keyed by the full origin; never the default session.
- Reuse healthy service. Only unavailable canonical default may receive
  `launchctl kickstart` without `-k`; no stop/restart/bootstrap of shared services.
- Keep source modules <=200 lines, errors free of secrets, and retries/timeouts bounded.
- No live service or production database mutations in tests. No app installation,
  quarantine changes, Fly, push or main changes without separate authorization.
