# Bots — External Interfaces

Bots are external-facing services that connect users to the RoceOS engine.
Each bot is a self-contained service that calls the engine via HTTP or CLI.

## Current Bots

### discord/ — Captain Hook
ICT trading assistant for the Wealth Building with ICT Discord server.
See [discord/README.md](discord/README.md) for details.

## Adding a New Bot

1. Create a directory under `bots/` (e.g., `bots/slack/`)
2. Include: entry point, requirements.txt, README.md, Dockerfile
3. Bot communicates with engine via `POST /chat` or `claude -p`
4. Bot does NOT import engine code directly
