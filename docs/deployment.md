# Marcuzx Forge Local Deployment

## Purpose
This guide describes how to run the current Marcuzx Forge MVP from the local workspace at:

`D:\01 Main Work\Boots\Agentic AI\mission-control`

The existing Next.js application remains the runtime host. Marcuzx Forge is layered into that host through:
- `/forge`
- `/forge/observatory`
- `/api/forge`

## Prerequisites
- Node.js 20 or newer
- npm available in the shell
- local workspace checked out at the path above

## Local Startup
```powershell
Set-Location "D:\01 Main Work\Boots\Agentic AI\mission-control"
npm install
npm run dev
```

Open:
- `http://127.0.0.1:3005/forge`
- `http://127.0.0.1:3005/forge/observatory`
- `http://127.0.0.1:3005/api/forge`

## Local Validation
```powershell
Set-Location "D:\01 Main Work\Boots\Agentic AI\mission-control"
npm run typecheck
node marcuzx-forge/control/index.mjs
```

## Orchestrator Integration
Marcuzx Forge now reads the local artifacts under `ai-orchestrator/output/`.

If those files are refreshed, the Forge API and UI will reflect the latest available:
- task outputs
- recommended implementation path
- risks and blockers
- verification checklist
- next operator action

## Production Notes
- Treat the current deployment target as the local host app first; the Forge modules are still file-based MVP modules.
- Keep the workspace-local registry and memory files with the deployed app.
- Do not assume cross-repo sync or remote automation is enabled yet.

## Known Gaps
- Forge does not yet trigger the orchestrator bridge directly from the UI.
- PR/build telemetry is not yet displayed in the Observatory.
- External repo registration beyond the current workspace remains manual.
