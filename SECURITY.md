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
- Enable `MC_COOKIE_SECURE=true` when serving over HTTPS.
- Review the [Environment Variables](README.md#environment-variables) section for all security-relevant configuration.
