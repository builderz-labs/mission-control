# Remote Access — phone shell + persistent Claude auth

Two interlocking systems let Ross operate the stack from anywhere without keyboard-and-laptop time:

1. **Long-lived Claude OAuth Token (OAT)** — every `claude` invocation (CLI sessions, Captain Hook, scheduled jobs) authenticates via a stable token that doesn't expire on the OAuth-refresh timescale. No more 401s mid-session, no more re-running `/login`.
2. **Phone SSH to VPS** — Termius on iPhone with an SSH ID key authorized on the VPS. Land in a root shell from anywhere, run `claude` for an interactive Code session that auto-loads the OAT.

## Architecture summary

```
                          ┌─────────────────┐
                          │  Anthropic API  │
                          └────────┬────────┘
                                   │  CLAUDE_CODE_OAUTH_TOKEN (OAT)
                                   │  sk-ant-oat01-...
              ┌────────────────────┼────────────────────┐
              │                    │                    │
        WSL .bashrc          VPS .bashrc        VPS bot env
              │                    │                    │
       ~/.claude/oat-token   reads from       /opt/ict-discord-bot/.env
              │            /opt/ict-discord-          │
              │             bot/.env line              │
       claude (interactive  claude (Termius        Captain Hook
        on Roce-PC)         from phone)         (asyncio subprocess)
```

The OAT is stored in **one canonical place per machine** and read into env automatically by shell startup or systemd EnvironmentFile.

## How it was set up (history, for memory)

**Problem we solved (2026-04-25)**: WSL `~/.claude/.credentials.json` held a short-lived OAuth session token + refresh token. Every long idle / sleep / network blip broke the refresh chain → CLI got `401 authentication_error` mid-conversation → user had to `/login` again. A WSL→VPS cron sync was mirroring the broken creds onto VPS, which made the failover system silently drop to the paid Anthropic API key. Cost: unknown duration of paid API usage we didn't notice.

**Root cause**: the VPS `/opt/ict-discord-bot/.env` had `ANTHROPIC_API_KEY` set, which `claude -p` always prefers over `CLAUDE_CODE_OAUTH_TOKEN`. So even when we set the OAT, claude tried to validate it as a regular API key, failed, and the failover kicked in to the paid path.

**Fix**: `claude setup-token` issues a long-lived OAT. We wired it as `CLAUDE_CODE_OAUTH_TOKEN` everywhere it's needed, and removed `ANTHROPIC_API_KEY` from the bot env (image analysis still works because it reads its key from `/opt/llm-config.json`, a separate field).

## Token storage locations

| Location | Loaded by | Purpose |
|---|---|---|
| `~/.claude/oat-token` (WSL, chmod 600) | `~/.bashrc` and `~/.profile` export | Roce-PC interactive Claude Code |
| `/opt/ict-discord-bot/.env` line `CLAUDE_CODE_OAUTH_TOKEN=...` | systemd `EnvironmentFile=` for captain-hook + sourced by `/root/.bashrc` on VPS | Captain Hook bot, scheduler, any VPS-side `claude -p` |

Same physical token in both places — rotate them together using the procedure below.

## Rotation procedure

When the OAT expires, gets revoked, or is suspected leaked:

1. Revoke the old token at https://console.anthropic.com/settings/keys (look for the `sk-ant-oat01-...` entry; pull the suffix from current env so you know which to revoke).
2. From WSL terminal: `claude setup-token`
3. Open the printed URL in any browser → Authorize → copy the auth code.
4. Paste the auth code at the CLI prompt. The new OAT prints immediately after.
5. Save it: `mv <token> ~/.claude/oat-token && chmod 600 ~/.claude/oat-token`
6. Push to VPS: `scp ~/.claude/oat-token root@187.127.96.74:/root/oat-token-new`
7. SSH to VPS: `NEW=$(cat /root/oat-token-new) && sed -i "s|^CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=$NEW|" /opt/ict-discord-bot/.env && shred -u /root/oat-token-new && systemctl restart captain-hook`
8. Verify (smoke test below).

If the local CLI is too dead to run `claude setup-token` (the chicken-and-egg case), use `tmux` to run it under a captureable pty — the dashboard build at `dashboard/web/` includes the pattern in `scripts/` history.

## Smoke test (run after rotation or any auth change)

```bash
# WSL — fresh login shell should auto-export the OAT
bash -lic 'echo OAT_set=$([ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] && echo yes || echo NO)'
bash -lic 'claude -p --model haiku "reply with: working"'

# VPS — bot env should route through claude-cli
ssh root@187.127.96.74 'cd /docker/roce-os/bots/discord && set -a && . /opt/ict-discord-bot/.env && set +a && python3 -c "
import asyncio, sys; sys.path.insert(0,\"/opt\")
from llm_failover import llm_call, get_config
async def go():
    print(await llm_call(prompt=\"reply with: working\", model=\"haiku\"))
    print(\"last_success:\", get_config().get(\"last_success\"))
asyncio.run(go())"'
```

Both should print `working`. The VPS test should print `last_success: claude-cli`. If it prints `anthropic-api`, the OAT path is broken — something is set wrong.

## Phone SSH (Termius)

**One-time setup:**

1. Install Termius (free) on iOS or Android.
2. Termius → Settings → Account Settings → **SSH ID** — Termius auto-generates an ECDSA-sha2-nistp256 keypair tied to your Termius account.
3. Public key for `@spaceghostroce` is published at `https://sshid.io/spaceghostroce` and is already installed on VPS `/root/.ssh/authorized_keys` (key #5).
4. In Termius: **Hosts** tab → **`+`** → New Host:
   - **Hostname**: `187.127.96.74` (or `srv1497155.hstgr.cloud`)
   - **Port**: `22`
   - **Username**: `root`
   - **Key/Identity**: select your SSH ID
   - **No password**
5. Save and tap to connect — you should land at `root@srv1497155:~#`.

**Daily use**: open Termius, tap saved host, run `claude` (or any system command). VPS `/root/.bashrc` auto-loads `CLAUDE_CODE_OAUTH_TOKEN` so your interactive Claude Code session uses the long-lived OAT immediately.

## Monitoring

`/opt/scripts/llm_auth_check.sh` runs every 30 minutes via cron. Reads `/opt/llm-config.json` `last_success`. If it's anything other than `claude-cli` for 4 consecutive runs (2 hours), pings Telegram via `@roce_os_bot` once.

State: `/var/lib/llm-failover/consec_non_oauth`.
Log: `/var/log/llm-auth-check.log`.

This is the alarm we built specifically because the previous failure mode was silent (failover to paid API, no signal). Now if auth degrades for 2h+ Ross knows.

## What NOT to do

- **Never set `ANTHROPIC_API_KEY` on a system that should use OAT.** Claude CLI prefers it and silently routes to the paid API. The bot's `.env` line is commented out as `# DISABLED:` for this reason.
- **Never paste an OAT in chat or Telegram.** Use SSH to grep it from the VPS env file directly. Memory file `feedback_no_secrets_in_chat.md` documents two leaks that caused rotations.
- **Never re-enable the WSL→VPS `.credentials.json` sync.** That cron was the band-aid that masked auth failures because it always made creds look fresh. The OAT is now the only path; if it expires, the monitor catches it.
- **Never grep a file that may contain a secret.** Output goes to stdout → conversation transcript → potential leak. Use Python's `with open(...) as f` and write to a chmod-600 file. Print only prefix+suffix+length for verification.

## Roadmap context

The pieces of this system live across several roadmap entries:

- `infra/api_max_migration` — original $0 routing
- `infra/claude_oat_resilience` — long-lived OAT + monitoring (2026-04-25)
- `infra/system_self_heal` — health checks + auto-restart (2026-04-25)

Source of truth: `docs/roadmap.yaml`. Rendered at https://dashboard.ictwealthbuilding.com/roadmap.
