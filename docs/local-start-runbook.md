# Local Startup Runbook

Use this when starting Mission Control locally or when startup fails because the app port is already in use.

## Defaults

- `pnpm dev` binds to `127.0.0.1:${PORT:-3000}`
- `pnpm start` binds to `0.0.0.0:${PORT:-3000}`
- If `PORT` is unset, both commands use `3000`

That matches `package.json` and `.env.example`.

## Standard local start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open http://localhost:3000.

## Local production-style start

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

If port `3000` is busy, choose another port explicitly:

```bash
PORT=3001 pnpm dev
# or
PORT=3001 pnpm start
```

## Handling `EADDRINUSE`

`EADDRINUSE` means another process is already listening on the selected port.

Check what owns the port:

```bash
lsof -iTCP:3000 -sTCP:LISTEN
```

Typical fixes:

1. Stop the existing process if it is a stale local Mission Control or Next.js server.
2. If that process should keep running, start Mission Control on a different port:

```bash
PORT=3001 pnpm dev
# or
PORT=3001 pnpm start
```

## Notes

- Do not copy secrets out of `.env`; only confirm whether `PORT` is set.
- For reverse-proxy or deployment guidance, see `docs/deployment.md`.
