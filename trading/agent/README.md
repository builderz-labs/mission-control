# ICT Agent — Quickstart Guide

Automated futures execution for the ICT Killzone scanner. Signals come from the server — your broker credentials never leave this machine.

---

## Prerequisites

- **Tradovate account** with the API Add-On enabled ($25/month — enable at tradovate.com → Account → Subscriptions)
- **Pairing token** from your admin (expires 48 hours, single-use)

---

## Install

### Option A — Windows Installer (recommended, no Python needed)

1. Download `ict-agent-setup-{version}.exe` from the latest release
2. Run the installer — installs to `%LOCALAPPDATA%\ICTAgent`
3. Windows SmartScreen may warn: click **More info → Run anyway** (beta, unsigned)
4. The setup wizard launches automatically after install

### Option B — Python (all platforms)

```bash
pip install httpx>=0.25 websockets>=12 keyring>=24
python signal_agent.py --setup
```

---

## First-Time Setup

Run the setup wizard:

```
ICT-Agent.exe --setup
```

You will be prompted for:

1. **Pairing token** — the one-time token from your admin
2. **Tradovate username** — your account email
3. **Tradovate password** — stored in Windows Credential Manager (never in a file)
4. **Tradovate App ID** — from tradovate.com → Account → API Access → App ID
5. **Tradovate Secret** — from the same page

Setup completes in under 2 minutes. The agent pairs with the server and saves your config to `%USERPROFILE%\.ict-agent\config.json`.

---

## Running the Agent

```
ICT-Agent.exe
```

The agent:
- Connects to `wss://api.ictwealthbuilding.com/ws/signals`
- Starts in **DEMO mode** (paper trades on Tradovate demo)
- Switches to **LIVE mode** only when your admin enables it on the server
- Reconnects automatically if the connection drops

### Pause / Resume (without stopping the process)

```
# Pause — stops new executions, keeps connection open
echo. > %USERPROFILE%\.ict-agent\PAUSED

# Resume
del %USERPROFILE%\.ict-agent\PAUSED
```

---

## Files

| Path | Purpose |
|------|---------|
| `%USERPROFILE%\.ict-agent\config.json` | Server URL, user ID, risk settings |
| `%USERPROFILE%\.ict-agent\state.json` | Executed signal IDs (dedup, survives restarts) |
| `%USERPROFILE%\.ict-agent\agent.log` | Full log (rotates daily) |
| `%USERPROFILE%\.ict-agent\PAUSED` | Create this file to pause execution |
| Windows Credential Manager | Tradovate credentials + JWT (never in files) |

---

## Risk Settings

Edit `config.json` to adjust per-trade risk. **Server entitlement overrides local settings** — the server caps take precedence.

```json
{
  "risk": {
    "qty": 1,
    "max_daily_trades": 3,
    "allowed_symbols": ["ES=F", "NQ=F"]
  }
}
```

---

## FAQ

**Q: Do my Tradovate credentials leave my machine?**
No. They are stored in Windows Credential Manager and used only to authenticate directly to Tradovate's API.

**Q: Who controls when I go live?**
Your admin. The agent starts in DEMO mode and only switches to live when the server pushes `live_enabled: true` to your session.

**Q: What happens if the server goes down?**
The agent retries with exponential backoff (max 60 seconds between attempts). No orders are placed while disconnected.

**Q: Can I run multiple instances?**
No — one instance per machine. A second instance would use the same signal dedup state and might skip valid signals.

**Q: How do I update?**
Run the new `ict-agent-setup-{version}.exe` — it overwrites the previous installation. Your config and credentials are preserved.

---

## Support

Contact your admin or post in the Discord channel.
