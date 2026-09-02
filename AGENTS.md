# Mission Control desktop

Thin Electron shell installed as `~/Applications/Mission Control.app`.
The dashboard process stays in `~/Dev/mission-control` on `127.0.0.1:3000`.

- Start server: LaunchAgent `com.tylerdevries.mission-control`
- Build app: `npm run build` (also run by hourly fleet-heal)
- Open window: `npm start` or the Applications bundle
- Tests: `npm test`
- Do not bind off localhost. Do not copy `.env` here.
- The app signs in with `AUTH_USER`/`AUTH_PASS` from `~/Dev/mission-control/.env` so the login form is skipped.
- Handoff: `python3 ~/Dev/omnia-vault/scripts/handoff.py --agent grok --summary "..."`
