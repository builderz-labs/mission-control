# Mission Control — Runbook local

## Emplacement
`/Users/infinity/.openclaw/workspace/projects/mission control`

## Démarrage
```bash
cd "/Users/infinity/.openclaw/workspace/projects/mission control"
pnpm install
pnpm dev
```

## URL locale
- http://127.0.0.1:3000

## Accès (local)
- Username: `matthieu`
- Password: `mc#ChangeNow2026`
- API key: `mc-local-key-2026`

> Credentials configurés dans `.env` local. À changer avant exposition réseau.

## Variables clés
- `OPENCLAW_HOME=/Users/infinity/.openclaw`
- `OPENCLAW_MEMORY_DIR=/Users/infinity/.openclaw/workspace/agents`
- `MC_ALLOWED_HOSTS=localhost,127.0.0.1`

## Processus en cours (session OpenClaw)
- Session id: `briny-atlas`

### Voir les logs
Utiliser l’outil process avec:
- `action: poll`
- `sessionId: briny-atlas`

### Stopper le serveur
- envoyer Ctrl+C au process, ou kill de session via l’outil process.

## Build production
```bash
pnpm build
OPENCLAW_HOME=/Users/infinity/.openclaw pnpm start
```
