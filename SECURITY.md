# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Mission Control, please report it responsibly.

**Do not open a public issue.** Instead, email security@builderz.dev with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest `main` | Yes |
| older releases | Best effort |

## Security Considerations

Mission Control handles authentication credentials and API keys. When deploying:

- Always set strong values for `AUTH_PASS` and `API_KEY`.
- Use `MC_ALLOWED_HOSTS` to restrict network access in production.
- Keep `.env` files out of version control (already in `.gitignore`).
- Enable `MC_COOKIE_SECURE=1` when serving over HTTPS.
- Review the [Environment Variables](README.md#environment-variables) section for all security-relevant configuration.

## Hardening Checklist

Run `bash scripts/security-audit.sh` to check your deployment automatically.

### Credentials
- [ ] `AUTH_PASS` is a strong, unique password (12+ characters)
- [ ] `API_KEY` is a random hex string (not the default)
- [ ] `AUTH_SECRET` is a random string
- [ ] `.env` file permissions are `600` (owner read/write only)

### Network
- [ ] `MC_ALLOWED_HOSTS` is configured (not `MC_ALLOW_ANY_HOST=1`)
- [ ] Dashboard is behind a reverse proxy with TLS (Caddy, nginx, Tailscale)
- [ ] `MC_ENABLE_HSTS=1` is set for HTTPS deployments
- [ ] `MC_COOKIE_SECURE=1` is set for HTTPS deployments
- [ ] `MC_COOKIE_SAMESITE=strict`

### Docker (if applicable)
- [ ] Use the hardened compose overlay: `docker compose -f docker-compose.yml -f docker-compose.hardened.yml up`
- [ ] Container runs as non-root user (default: `nextjs`, UID 1001)
- [ ] Read-only filesystem with tmpfs for temp dirs
- [ ] All Linux capabilities dropped except `NET_BIND_SERVICE`
- [ ] `no-new-privileges` security option enabled
- [ ] Log rotation configured (max-size, max-file)

### OpenClaw Gateway
- [ ] Gateway bound to localhost (`OPENCLAW_GATEWAY_HOST=127.0.0.1`)
- [ ] Gateway token configured (`OPENCLAW_GATEWAY_TOKEN`)
- [ ] Gateway token NOT exposed via `NEXT_PUBLIC_*` variables

### Monitoring
- [ ] Rate limiting is active (`MC_DISABLE_RATE_LIMIT` is NOT set)
- [ ] Audit logging is enabled with appropriate retention
- [ ] Regular database backups configured

See [docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md) for the full hardening guide.
