# Mission Control Local Bootstrap Quickstart

## One command

```bash
cd ~/Projects/mission-control
pnpm bootstrap:local
```

This command:
1. validates Node/pnpm
2. ensures `.env` exists
3. sets local defaults (`PORT=3244`, `MC_BIND_HOST=127.0.0.1`)
4. builds Mission Control
5. installs + starts launchd services
6. runs `pnpm healthcheck`

## Daily use

No terminal/SSH required after bootstrap.

Open from your personal browser on LAN:
- `http://<mac-lan-ip>:3244`
- `http://<hostname>.local:3244`

## Service commands (if needed)

```bash
launchctl kickstart -k "gui/$(id -u)/ai.missioncontrol"
launchctl kickstart -k "gui/$(id -u)/ai.missioncontrol.lanrelay"
```

## Logs

```bash
tail -f ~/Projects/mission-control/.data/mc.log
tail -f ~/Projects/mission-control/.data/lanrelay.log
```
