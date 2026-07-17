# Screenshot Guide

This document explains how to capture and review public screenshots without publishing
operator data. Treat every screenshot as a public release artifact.

## Screenshots in the README

The README uses conceptual artwork by default. Product screenshots may be added only when
they come from a disposable demo instance and pass the privacy review below.

## When to Refresh

Screenshots should be updated when:

- A new page, panel, or major UI component is added
- An existing page layout changes noticeably
- The color scheme or branding updates
- A GitHub Actions `screenshot-drift` label is applied to a PR (see [automation](#automation))

## How to Take New Screenshots

### Prerequisites

- Mission Control running against a new disposable database (`pnpm dev` or Docker)
- Browser with at least 1440×900 viewport recommended

### Steps

1. **Start a disposable demo instance.** Never capture an operator or production database.

   ```bash
   pnpm dev
   # or
   docker compose up
   ```

2. **Seed synthetic data only.** Use fictional names and values that cannot be mistaken for
   production claims.

   Populate the demo through the UI or a reviewed fixture script. Do not copy an existing
   database into the demo environment.

3. **Before capture, remove private state.** The frame must contain no real names, handles,
   email addresses, IDs, tokens, hostnames, paths, workspace names, sessions, logs, costs,
   alerts, timestamps, avatars, notifications, or browser profile chrome.

4. **Crop and optimise** to reduce file size:

   ```bash
   # macOS
   pngcrush -reduce -brute input.png output.png

   # Linux
   optipng -o5 input.png
   # or
   pngquant --quality=80-95 --output output.png input.png
   ```

5. **Review the final pixels at full resolution.** A second reviewer should inspect every
   visible label and value. Strip image metadata, then add the approved file under `docs/`.

   ```bash
   cp ~/Downloads/sanitized-demo.png docs/mission-control-demo.png
   git add docs/
   git commit -m "docs: refresh README screenshots"
   ```

## Automation

The repository has a GitHub Actions workflow (`.github/workflows/screenshot-drift.yml`) that:

- Detects changes to files under `src/app/`, `src/components/`, and `public/`
- Adds a `screenshot-drift` label to the PR as a reminder
- Posts a checklist comment listing which screenshots may need updating

This does **not** auto-capture screenshots — it just flags the PR so a human can decide whether the change is visually significant enough to warrant a refresh.

## Tips

- Use a consistent browser zoom level (100%) and window size
- Use a clean browser profile and hide bookmarks, extensions, account controls, and dev tools
- Light mode and dark mode screenshots can coexist — add a `*-dark.png` variant if useful
- Prefer PNG for UI screenshots (lossless); JPEG for photos/illustrations
- Do not blur or crop private data as the primary safeguard; regenerate the screenshot from
  synthetic state instead
