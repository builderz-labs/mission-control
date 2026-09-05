# Mission Control desktop

This package is a native Electron window onto one existing local Mission Control
backend. Default origin: `http://127.0.0.1:3000`. Never bundle or spawn a backend,
Node runtime, database, or alternate portable service.

- Package manager: `pnpm@10.29.3`; Electron must be exactly `44.2.0`.
- Parent owns repository workspace/lockfile changes and integration checks.
- Tests: `pnpm --dir apps/desktop test` (temporary fixtures only).
- Stage: `pnpm --dir apps/desktop build --stage-only --output /absolute/output`.
- Build never installs by default. Installation needs explicit `--install-to` or
  `MISSION_CONTROL_APP`; preserve the old bundle and support rollback.
- Resolve Electron from the installed dependency, including pnpm symlinks. An
  explicit Electron package override is permitted only for staged macOS builds.
- `MISSION_CONTROL_ROOT` identifies the canonical checkout; `MC_DESKTOP_ENV_FILE`
  can select an absolute local credentials file. Never copy secrets into artifacts.
- `MC_DESKTOP_URL` accepts explicit loopback HTTP origins with safe unprivileged
  ports. Validate before credentials. Health, login and window use the same origin.
- Refuse redirects and external navigation/popups. Preserve sandbox,
  contextIsolation, disabled nodeIntegration and single-instance behavior.
- Use ordinary local authentication and existing credentials. Never weaken cookies.
- Reuse healthy service. Only unavailable canonical default may receive
  `launchctl kickstart` without `-k`; no stop/restart/bootstrap of shared services.
- Keep source modules <=200 lines, errors free of secrets, and retries/timeouts bounded.
- No live service or production database mutations in tests. No app installation,
  quarantine changes, Fly, push or main changes without separate authorization.
