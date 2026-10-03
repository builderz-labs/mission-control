# AI Ops Hub — Local Setup

## What the user does
Normal operation should require only human decisions, not terminal commands.

1. Windows logon starts AI Ops Hub.
2. Open http://127.0.0.1:3000
3. Home shows Approval Inbox first.
4. Approve / request changes / hold.
5. Runner continues allowed workflow steps in the background.

## First-time setup
1. Start the hub:
   `powershell -ExecutionPolicy Bypass -File .\scripts\start-ai-ops-hub.ps1 -Dev`
2. Open `http://127.0.0.1:3000/setup`.
3. Create the local admin account.
4. The server automatically generates a local API key in `.data/.auto-generated`; the Runner reads it directly. You do not need to copy or paste the key.
5. Bootstrap configured projects and sync the current Shufuro marketing queue if you want to run them manually:
   `pnpm aiops:bootstrap`
   `pnpm aiops:sync:shufuro`
   The startup script also runs both automatically.
6. Register Windows logon startup:
   `powershell -ExecutionPolicy Bypass -File .\scripts\register-ai-ops-startup.ps1`

## Local config
Machine-specific project paths are stored in:
`.data\ai-ops-config.json`

This path is git-ignored.

Current intended projects:
- Shufuro
- ProductBaton

Current skill roots:
- `C:\Users\user\.agents\skills`
- `C:\Users\user\.codex\skills`

## Safety boundaries
The Runner does not execute arbitrary metadata as shell code.
Only explicitly registered workflow handlers can run.

Human approval remains mandatory for workflow-specific risky actions such as:
- social publishing when policy requires review
- git push
- merge
- deploy
- destructive skill removal
- login / CAPTCHA / 2FA

## Development commands
Windows-safe commands:
- `pnpm aiops:dev`
- `pnpm aiops:start`
- `pnpm aiops:runner`
- `pnpm aiops:runner:once`
- `pnpm aiops:bootstrap`

Upstream's generic `pnpm dev` / `pnpm start` scripts use POSIX-style PORT expansion and should not be used directly from Windows CMD.
