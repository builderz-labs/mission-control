# Mission Control desktop

Self-contained Electron app at `~/Applications/Mission Control.app`.
The production Next.js standalone server is copied into
`Contents/Resources/app/server` and spawned on `127.0.0.1:18791`.
A Node binary ships in `Contents/Resources/app/runtime/node`.
The window paints `src/shell.html` from disk immediately, then navigates
to the bundled origin once `/health` is ok.

- Build (and zip): `npm run build` → `~/Applications/Mission Control.app`
  and `~/Applications/Mission Control.zip`
- Open: `npm start` or the Applications bundle
- Tests: `npm test`
- Bundled origin stays on `127.0.0.1`. Do not copy `.env` into the app.
- LaunchAgent `com.tylerdevries.mission-control` runs production standalone
  on `:3000` (`MC_HOSTNAME=0.0.0.0`) for LAN. Never start live-main / `next dev`.
- Runtime data prefers `~/Dev/mission-control/.data` when present, else
  `~/Library/Application Support/Mission Control/data`.
- Auth uses `AUTH_USER`/`AUTH_PASS` from `~/Dev/mission-control/.env`.
- `MC_DESKTOP_URL` is a manual override only. Opening the .app must wait on
  bundled `/health {status:ok}` (reject `{live:false}`) then load that origin.
- Never package `next dev`. Rebuild the app after `pnpm build` in
  `~/Dev/mission-control` so the shipped UI matches main.
- Handoff: `python3 ~/Dev/omnia-vault/scripts/handoff.py --agent grok --summary "..."`
