# Phase 3 — Clerk SSO Cutover Runbook

**Status:** Scaffold landed. Per-tenant cutover is an operator action.
**Owner:** Platform / Mission Control
**Estimate per tenant:** ~45 min (provisioning + smoke + 30 min observation)
**Rollback:** trivial (revert env vars + restart MC; Caddy still has CF Access app loaded)

## Pre-flight (one time, not per-tenant)

- Confirm Lumina Clerk prod instance has orgs for every MC tenant.
  - Verify in the Clerk dashboard at `https://dashboard.clerk.com/apps/<lumina-prod>/instances/<prod>/organizations`.
  - Each tenant org should match the slug used in `CLERK_ORG_TENANT_MAP` (e.g. `ceremonia`, `eric`, `lumina`).
- Install `@clerk/backend` in the MC image (Phase 3 BUILD D1 dependency add — separate PR).
- Decide on `CLERK_JWT_AUDIENCE` per environment (recommend `mission-control` literal across all tenants for simplicity; revisit if multi-MC isolation tightens).

## Per-tenant cutover sequence

For each tenant in `{ceremonia, eric, lumina}` (do `ceremonia` first as canary):

### 1. Provision Clerk org membership

Confirm the tenant's MC operator email(s) are members of the Clerk org. Add via Clerk dashboard if missing.

### 2. Add env vars to `/opt/mc-{tenant}/.env`

```bash
# SSH to Hetzner host (NOT the dev host — see global rule on prod IP 159.69.144.136)
ssh -i ~/.ssh/openclaw-hetzner root@159.69.144.136

# On the host, for each tenant dir:
TENANT=ceremonia
cat <<'EOF' >> /opt/mc-${TENANT}/.env
# Clerk SSO (Phase 3) — replaces CF Access at the proxy edge
CLERK_PUBLISHABLE_KEY=pk_live_XXXX
CLERK_SECRET_KEY=sk_live_XXXX
CLERK_JWT_AUDIENCE=mission-control
CLERK_ORG_TENANT_MAP={"ceremonia":{"tenantId":1,"workspaceId":1}}
EOF
chmod 600 /opt/mc-${TENANT}/.env
```

Notes:
- Each tenant's MC has its own integer `tenantId`/`workspaceId`. Use `1`/`1` for any single-tenant MC; introduce non-1 values only when an MC instance hosts multiple Clerk orgs (not the current case).
- Secrets are tenant-scoped — never share an `sk_live` across tenants if you intend to revoke independently.
- `chmod 600` enforced; `docker restart` does NOT reload `env_file` — see step 3.

### 3. Recreate the MC container (NOT restart)

```bash
cd /opt/mc-${TENANT}
docker compose pull mission-control
docker compose down mission-control
docker compose up -d mission-control
```

Why down+up, not restart: `env_file` is only read at container creation. `docker restart` keeps the prior env (verified — see `feedback_docker_compose_env_file_reload.md`).

### 4. Smoke test

```bash
# From a workstation:
curl -sf -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer <fresh-clerk-jwt>" \
  https://mc-${TENANT}.holalumina.com/api/agents

# Expect: 200 (Clerk path) or 401 (config mismatch — debug).
```

Then interactive browser test:
- Open the MC instance in an incognito window.
- Sign in via Clerk org `${TENANT}`.
- Confirm: lands on dashboard, no double-login prompt, no CF Access challenge.

### 5. 30-min observation window

- Tail container logs: `docker compose logs -f mission-control | grep -E 'clerk|auth|401|500'`
- Confirm zero auth-related 5xx.
- Confirm sign-in events appear under the right tenant in MC's `security_events` table:
  ```sql
  SELECT event_type, severity, detail, created_at
  FROM security_events
  WHERE created_at > strftime('%s', 'now') - 1800
  ORDER BY created_at DESC
  LIMIT 20;
  ```

### 6. Remove CF Access app (Caddy/Cloudflare side)

Only after a clean 30-min window:

- In the Cloudflare Zero Trust dashboard, delete the Access application for `mc-${TENANT}.holalumina.com`.
- Or, if running self-hosted Caddy with `forward_auth` to Access, comment out that block in the Caddyfile and reload Caddy.
- Verify: a fresh unauthenticated request to `https://mc-${TENANT}.holalumina.com/api/me` returns 401 from MC (Clerk path), not a CF Access HTML challenge.

### 7. Cleanup

- Remove the tenant's CF Access seat from the Cloudflare team plan.
- Note in `MEMORY.md` Phase 3 progress: `{TENANT}` cut over on YYYY-MM-DD.

## Per-tenant rollback

If anything misbehaves during the 30-min window:

```bash
cd /opt/mc-${TENANT}
# 1. Comment out the Clerk block in /opt/mc-${TENANT}/.env
sed -i.bak 's/^CLERK_/# CLERK_/g' .env
# 2. Recreate the container
docker compose down mission-control
docker compose up -d mission-control
# 3. CF Access stays in place — no Caddy revert needed if step 6 hasn't run yet
```

After rollback, MC falls back to its prior auth (local login or proxy-auth header).

## Phase 3 BUILD scope NOT covered by this scaffold

The scaffold landing this PR ships:
- `clerk-resolver.ts` — JWT verifier interface + env reader
- `clerk-tenant-map.ts` — org slug → tenant binding
- `clerk-auth-resolver.ts` — `registerAuthResolver` shim (sync no-op stub + async path)
- `clerk-bootstrap.ts` — idempotent boot installer
- `plugin-loader.ts` — wires the installer in
- This runbook

Not yet implemented (Phase 3 BUILD D-series tasks):
- D2: `resolveOrProvisionProxyUser` org-claim gate at `auth.ts:386-431` (mints / verifies the synthetic `users` row keyed by `clerk_user_id`)
- D3: Clerk webhook route at `src/app/api/auth/clerk/webhook/route.ts` with Svix signature verification + `destroyAllUserSessions` plumb-through
- D4: Sign-in callback route at `src/app/api/auth/clerk/callback/route.ts` that mints the MC opaque session cookie from a Clerk JWT
- D5: Sqlite migration adding `users.clerk_user_id` + `tenants.clerk_org_id` unique indexes
- D6: Real async middleware in `auth.ts:getUserFromRequest` that calls `resolveClerkUser` (currently the sync hook stub is registered)
- E2E: Playwright dress-rehearsal on the canary tenant before cutting traffic

These are the explicit Phase 3 BUILD follow-ups. Operators should not flip env vars on production until D2–D6 land.

## References

- Spike report: `docs/artifacts/phase-3-clerk-auth-spike-20260519.md` (openclaw repo)
- Spike PR: openclaw#347
- Lumina platform Clerk integration: `openclaw/web/src/middleware.ts`, `openclaw/web/src/lib/auth/`
- Session cookie TTL rule: `~/.gstack/projects/openclaw/feedback_session_cookie_design_tool_ttl.md`
- Prod IP convention: `~/.gstack/projects/openclaw/feedback_hetzner_prod_ip_vs_dev_ip.md`
