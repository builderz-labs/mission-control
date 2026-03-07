# Mission Control Installer Skill

Install and configure Mission Control on any Linux or macOS system.

## What This Skill Does

1. Detects the target OS and available runtimes (Docker or Node.js 20+)
2. Clones or updates the Mission Control repository
3. Generates a secure `.env` with random credentials
4. Starts the dashboard via Docker Compose or local Node.js
5. Runs an OpenClaw fleet health check (cleans stale PIDs, old logs, validates gateway)
6. Prints the access URL and admin credentials

## Usage

Run the installer script:

```bash
# Auto-detect deployment mode (prefers Docker)
bash install.sh

# Force Docker deployment
bash install.sh --docker

# Force local deployment (Node.js + pnpm)
bash install.sh --local

# Custom port
bash install.sh --port 8080

# Skip OpenClaw fleet check
bash install.sh --skip-openclaw
```

Or as a one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/builderz-labs/mission-control/main/install.sh | bash
```

## Prerequisites

- **Docker mode**: Docker Engine with Docker Compose v2
- **Local mode**: Node.js 20+, pnpm (auto-installed via corepack if missing)
- **Both**: git (to clone the repository)

## Post-Install

After installation:

1. Open `http://localhost:3000` (or your configured port)
2. Log in with the credentials printed by the installer (also in `.env`)
3. Configure your OpenClaw gateway connection in Settings
4. Register agents via the Agents panel

## Environment Configuration

The installer generates a `.env` from `.env.example` with secure random values for:

- `AUTH_PASS` — 24-character random password
- `API_KEY` — 32-character hex API key
- `AUTH_SECRET` — 32-character session secret

To regenerate credentials independently:

```bash
bash scripts/generate-env.sh --force
```
