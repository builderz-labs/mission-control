# 04 — Runtime

Agents run as Node.js processes on the **SpiderMan** macOS user account. The Mainframe account hosts Ollama
for local inference. The Jackson account is admin-only.

## Process layout (Phase 0)

| Process | Account | Description |
|---|---|---|
| DarkMada web (Next.js) | SpiderMan | Serves the v3 UI + API |
| Hermes gateway | SpiderMan | Multiplexes agent runtimes |
| Ollama | Mainframe | Hosts Qwen 3.5, GLM 4.6, Nemotron, MiniMax 2.5 |
| n8n (optional) | SpiderMan | Cron + webhook workflows |
| MCP services | SpiderMan | Today: in-process; Phase 1: separate Node service |

## Process layout (Phase 1, Mac mini online)

The Mac mini runs SpiderMan + Mainframe as system users. The MacBook Pro keeps the Jackson account for
operator work and acts as a hot client. WireGuard mesh links them.

## Lifecycle of a run

1. Trigger fires (cron, webhook, DarkMada button, Telegram message).
2. DarkMada writes a `tasks` record + emits to Event Bus.
3. Thinky claims the task, picks an agent + model (per `05-model-fabric.md`).
4. Agent process is spawned (or reused) under SpiderMan.
5. Context Loader assembles the prompt; agent runs; tool calls go through Tool Access.
6. Outputs land in `reports` / `artifacts`; status updated; audit log written.
7. Approvals (if any) surface in The Office; Jackson approves or rejects.
8. n8n delivers the final output to the requested channel.

## Failure modes

- **Model timeout** → Thinky retries on fallback model (always documented in the run record).
- **Tool denied** → request lands in `approvals`; surfaces in DarkMada + push to iPhone.
- **Process crash** → systemd-style supervisor restarts; Seccy alerts if restart loop > 3.
- **Network down** → local-only models + queued external calls; resume on reconnect.
