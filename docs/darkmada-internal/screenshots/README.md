# DarkMada — Screenshots

This directory holds rendered captures of every DarkMada surface and System Atlas page.

## Capture

```bash
pnpm dev                                     # in one terminal
node scripts/capture-darkmada-screenshots.mjs  # in another
```

The script writes PNGs at `1440x900` (full page) into this directory.

## Expected files

### DarkMada surfaces

- `the-office.png` — daily HUD
- `command-deck.png` — fleet status
- `org-chart.png` — agent hierarchy
- `assembly-line.png` — workflow lanes
- `the-vault.png` — Supabase truth-source registry
- `the-library.png` — Obsidian mirror view
- `the-workshop.png` — skills + MCP servers
- `idea-forge.png` — capture → ship board
- `intelligence-room.png` — Velma's research

### System Atlas

- `atlas-overview.png`
- `atlas-system.png`
- `atlas-execution.png`
- `atlas-memory.png`
- `atlas-org.png`
- `atlas-mcp.png`
- `atlas-runtime.png`
- `atlas-compute.png`
- `atlas-network.png`
- `atlas-scale.png`
- `atlas-ui-map.png`

## Notes

- Captures use the `void` (default) dark theme.
- Auth: the dev server must be unlocked (or run with `AUTH_USER`/`AUTH_PASS` set + a session cookie).
- For headless environments, prefix the route with the dev base URL via `MC_URL`.
