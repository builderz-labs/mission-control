# Security Hardening Guide

Comprehensive security hardening guide for Mission Control and OpenClaw Gateway deployments.

## Quick Assessment

Run the automated security audit:

```bash
bash scripts/security-audit.sh        # Check .env and configuration
bash scripts/station-doctor.sh         # Check runtime health
```

Or use the diagnostics API (admin only):

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/diagnostics
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/security-audit?timeframe=day
```

The `posture.score` field (0-100) gives a quick posture assessment. The **Security Audit Panel** (`/security` in the dashboard) provides a full real-time view with timeline charts, agent trust scores, and eval results.

---

## Mission Control Hardening

### 1. Credentials

**Generate strong credentials** using the included script:

```bash
bash scripts/generate-env.sh           # Generates .env with random secrets
chmod 600 .env                          # Lock down permissions
```

The installer (`install.sh`) does this automatically. If you set up manually, ensure:

- `AUTH_PASS` is 12+ characters, not a dictionary word
- `API_KEY` is 32+ hex characters
- `AUTH_SECRET` is a unique random string
- `.env` file permissions are `600`

### 2. Network Access Control

Mission Control uses a host allowlist in production:

```env
# Only allow connections from these hosts (comma-separated)
MC_ALLOWED_HOSTS=localhost,127.0.0.1

# For Tailscale: MC_ALLOWED_HOSTS=localhost,127.0.0.1,100.*
# For a domain: MC_ALLOWED_HOSTS=mc.example.com,localhost

# NEVER set this in production:
# MC_ALLOW_ANY_HOST=1
```

Deploy behind a reverse proxy with TLS (Caddy, nginx, Tailscale Funnel) for any network-accessible deployment.

### 3. HTTPS & Cookies

For HTTPS deployments:

```env
MC_COOKIE_SECURE=1           # Cookies only sent over HTTPS
MC_COOKIE_SAMESITE=strict    # CSRF protection
MC_ENABLE_HSTS=1             # HTTP Strict Transport Security
```

### 4. Rate Limiting

Rate limiting is enabled by default:

| Endpoint Type | Limit |
|--------------|-------|
| Login | 5 attempts/min (always active) |
| Mutations | 60 requests/min |
| Reads | 120 requests/min |
| Heavy operations | 10 requests/min |
| Agent heartbeat | 30/min per agent |
| Agent task polling | 20/min per agent |

Never set `MC_DISABLE_RATE_LIMIT=1` in production.

### 5. Docker Hardening

Use the production compose overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

This enables:
- **Read-only filesystem** with tmpfs for `/tmp` and `/app/.next/cache`
- **Capability dropping** — all Linux capabilities dropped, only `NET_BIND_SERVICE` retained
- **No new privileges** — prevents privilege escalation
- **PID limit** — prevents fork bombs
- **Memory/CPU limits** — prevents resource exhaustion
- **Log rotation** — prevents disk filling from verbose logging
- **HSTS, secure cookies** — forced via environment

### 6. Security Headers

Mission Control sets these headers automatically:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic'; style-src 'self' 'nonce-<per-request>'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Request-Id` | Unique per-request UUID for log correlation |
| `Strict-Transport-Security` | Set when `MC_ENABLE_HSTS=1` |

### 7. Audit Logging

All security-relevant events are logged to the audit trail:

- Login attempts (success and failure)
- Task mutations
- User management actions
- Settings changes
- Update operations

Additionally, the **security event system** automatically logs:

- Auth failures (invalid passwords, expired tokens, access denials)
- Rate limit hits (429 responses with IP/agent correlation)
- Injection attempts (prompt injection, command injection, exfiltration)
- Secret exposures (AWS keys, GitHub tokens, Stripe keys, JWTs, private keys detected in agent messages)
- MCP tool calls (agent, tool, duration, success/failure)

These events feed into the **Security Audit Panel** (`/security`) which provides:

- **Posture score** (0-100) with level badges (hardened/secure/needs-attention/at-risk)
- **Agent trust scores** — weighted calculation based on auth failures, injection attempts, and task success rates
- **MCP call audit** — tool-use frequency, success/failure rates per agent
- **Timeline visualization** — event density over selected timeframe

Configure retention: `MC_RETAIN_AUDIT_DAYS=365` (default: 1 year).

### 8. Hook Profiles

Security strictness is tunable via hook profiles in Settings > Security Profiles:

| Profile | Secret Scanning | MCP Auditing | Block on Secrets | Rate Limit Multiplier |
|---------|----------------|--------------|------------------|----------------------|
| **minimal** | Off | Off | No | 2x (relaxed) |
| **standard** (default) | On | On | No | 1x |
| **strict** | On | On | Yes (blocks messages) | 0.5x (tighter) |

Set via the Settings panel or the `hook_profile` key in the settings API.

### 9. Agent Eval Framework

The four-layer eval stack helps detect degrading agent quality:

- **Output evals** — score task completion against golden datasets
- **Trace evals** — convergence scoring (>3.0 indicates looping behavior)
- **Component evals** — tool reliability from MCP call logs (p50/p95/p99 latency)
- **Drift detection** — 10% threshold vs 4-week rolling baseline triggers alerts

Access via `/api/agents/evals` or the Security Audit Panel's eval section.

### 10. Data Retention

```env
MC_RETAIN_ACTIVITIES_DAYS=90       # Activity feed
MC_RETAIN_AUDIT_DAYS=365           # Security audit trail
MC_RETAIN_LOGS_DAYS=30             # Application logs
MC_RETAIN_NOTIFICATIONS_DAYS=60    # Notifications
MC_RETAIN_PIPELINE_RUNS_DAYS=90    # Pipeline logs
MC_RETAIN_TOKEN_USAGE_DAYS=90      # Token/cost records
MC_RETAIN_GATEWAY_SESSIONS_DAYS=90 # Gateway session history
```

### 11. Runtime Installer Integrity

Dashboard-triggered OpenClaw and Hermes installations execute third-party
shell installers. Local runtime installation is disabled by default. Enable it
only after reviewing the source and rollback path. Mission Control also
requires an operator-approved SHA-256 digest before either remote script can
run:

```env
MC_ENABLE_RUNTIME_INSTALLS=1
MC_OPENCLAW_INSTALLER_SHA256=<64 lowercase hex characters>
MC_HERMES_INSTALLER_SHA256=<64 lowercase hex characters>
# Required only for per-user installs from the super-admin organization flow:
MC_OPENCLAW_GIT_COMMIT=<reviewed 40-character commit SHA>
MC_CLAUDE_CODE_VERSION=<exact semver>
MC_CODEX_VERSION=<exact semver>
```

Download the installer separately through a trusted channel, inspect it, and
calculate its digest with `sha256sum install.sh` (Linux) or
`shasum -a 256 install.sh` (macOS). If the publisher changes the installer,
the dashboard install fails closed until you review the new bytes and update
the configured digest. Regex and optional AI review remain defense-in-depth;
they do not replace provenance verification.

---

## OpenClaw Gateway Hardening

Mission Control acts as the mothership for your OpenClaw fleet. The installer automatically checks and repairs common OpenClaw configuration issues.

### 1. Network Security

- **Never expose the gateway publicly.** It runs on port 18789 by default.
- **Bind to localhost:** Set `gateway.bind: "loopback"` in `openclaw.json`.
- **Use SSH tunneling or Tailscale** for remote access.
- **Docker users:** Be aware that Docker can bypass UFW rules. Use `DOCKER-USER` chain rules.

### 2. Authentication

- **Always enable gateway auth** with a strong random token.
- Generate: `openclaw doctor --generate-gateway-token`
- Store in `OPENCLAW_GATEWAY_TOKEN` env var (never in `NEXT_PUBLIC_*` variables).
- Rotate regularly.

### 3. Hardened Gateway Configuration

```json
{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "replace-with-long-random-token"
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  },
  "tools": {
    "profile": "messaging",
    "deny": ["group:automation", "group:runtime", "group:fs", "sessions_spawn", "sessions_send"],
    "fs": { "workspaceOnly": true },
    "exec": { "security": "deny", "ask": "always" }
  },
  "elevated": { "enabled": false }
}
```

### 4. File Permissions

```bash
chmod 700 ~/.openclaw
chmod 600 ~/.openclaw/openclaw.json
chmod 600 ~/.openclaw/credentials/*
```

### 5. Tool Security

- Apply the principle of least privilege — only grant tools the agent needs.
- Audit third-party skills before installing (Mission Control's Skills Hub runs automatic security scans).
- Run agents processing untrusted content in a sandbox with a minimal toolset.

### 6. Monitoring

- Enable comprehensive logging: `logging.redactSensitive: "tools"`
- Store logs separately where agents cannot modify them.
- Use Mission Control's diagnostics API to monitor gateway health.
- Have an incident response plan: stop gateway, revoke API keys, review audit logs.

### 7. Known CVEs

Keep OpenClaw updated. Notable past vulnerabilities:

| CVE | Severity | Description | Fixed In |
|-----|----------|-------------|----------|
| CVE-2026-25253 | Critical | RCE via Control UI token hijack | v2026.1.29 |
| CVE-2026-26327 | High | Auth bypass via gateway spoofing | v2026.2.25 |
| CVE-2026-26322 | High | SSRF | v2026.2.25 |
| CVE-2026-26329 | High | Path traversal | v2026.2.25 |
| CVE-2026-26319 | Medium | Missing webhook auth | v2026.2.25 |

---

## Deployment Architecture

For production, the recommended architecture is:

```
Internet
  |
[Reverse Proxy (Caddy/nginx) + TLS]
  |
[Mission Control :3000] ---- [SQLite .data/]
  |
[OpenClaw Gateway :18789 (localhost only)]
  |
[Agent Workspaces]
```

- Reverse proxy handles TLS termination, rate limiting, and access control
- Mission Control listens on localhost or a private network
- OpenClaw Gateway is bound to loopback only
- Agent workspaces are isolated per-agent directories

---

## Agent Auth: Least-Privilege Key Guidance

### The Problem

The global API key (`API_KEY` env var) grants full `admin` access. When agents use it, they can:
- Create/delete other agents
- Modify any task or project
- Rotate the API key itself
- Access all workspaces

This violates least-privilege. A compromised agent session leaks admin access.

### Recommended: Agent-Scoped Keys

Create per-agent keys with limited scopes:

```bash
# Create a scoped key for agent "Aegis" (via CLI)
pnpm mc raw --method POST --path /api/agents/5/keys --body '{
  "name": "aegis-worker",
  "scopes": ["viewer", "agent:self", "agent:diagnostics", "tasks:write"],
  "expires_in_days": 30
}' --json
```

Scoped keys:
- Can only act as the agent they belong to (no cross-agent access)
- Have explicit scope lists (viewer, agent:self, tasks:write, etc.)
- Auto-expire after a set period
- Can be revoked without affecting other agents
- Are logged separately in the audit trail

### Auth Hierarchy

| Method | Role | Use Case |
|--------|------|----------|
| Agent-scoped key (`mca_...`) | Per-scope | Autonomous agents (recommended) |
| Global API key | admin | Admin scripts, CI/CD, initial setup |
| Session cookie | Per-user role | Human operators via web UI |
| Proxy header | Per-user role | SSO/gateway-authenticated users |

### Monitoring Global Key Usage

Mission Control logs a security event (`global_api_key_used`) every time the global API key is used. Monitor these in the audit log:

```bash
pnpm mc raw --method GET --path '/api/security-audit?event_type=global_api_key_used&timeframe=day' --json
```

Goal: drive global key usage to zero in production by replacing with scoped agent keys.

### Rate Limiting by Agent Identity

Agent-facing endpoints use per-agent rate limiters (keyed by `x-agent-name` header):
- Heartbeat: 30/min per agent
- Task polling: 20/min per agent
- Self-registration: 5/min per IP

This prevents a runaway agent from consuming the entire rate limit budget.

---

## Rate Limit Backend Strategy

Current: in-memory `Map` per process (suitable for single-instance deployments).

For multi-instance deployments, the rate limiter supports a pluggable backend via the `createRateLimiter` factory. Future options:
- **Redis**: shared state across instances (use Upstash or self-hosted)
- **SQLite WAL**: leverage the existing DB for cross-process coordination
- **Edge KV**: for edge-deployed instances

The current implementation includes:
- Periodic cleanup (60s interval)
- Capacity-bounded maps (default 10K entries, LRU eviction)
- Trusted proxy IP parsing (`MC_TRUSTED_PROXIES`)

No action needed for single-instance deployments. For multi-instance, implement a custom `RateLimitStore` interface when scaling beyond 1 node.
