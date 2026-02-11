# Super Mission Control Plan

## Goal
Build a **control plane** in Mission Control that can:
- Create and manage tenant/client instances
- Provision linux users and OpenClaw workspaces from UI workflows
- Track provisioning jobs, approvals, logs, and outcomes
- Monitor per-tenant gateways, dashboards, and token/cost usage

## Current Implementation (Phase 1)
- Added tenant model (`tenants`) and provisioning queue (`provision_jobs`, `provision_events`).
- Added admin APIs:
  - `GET/POST /api/super/tenants`
  - `GET/POST /api/super/provision-jobs`
  - `GET /api/super/provision-jobs/:id`
  - `POST /api/super/provision-jobs/:id/run`
- Added execution framework in `src/lib/super-admin.ts`:
  - idempotent bootstrap plan generation
  - dry-run mode by default
  - event log per step
  - audit events for request/success/failure
- Added a first UI panel (`Super Admin`) for tenant creation + job execution + event log.

## Architecture Direction
- Keep Mission Control web app unprivileged.
- Use a dedicated privileged provisioner path with strict allow-list and audit.
- Require explicit approval before non-dry-run execution.
- Keep tenant isolation as first-class primitive (user, paths, services, data).

## Security & Platform Best Practices (web research)
1. Least privilege for provisioning actions; avoid direct root in app runtime.
2. Restrict `sudo` to explicit command allow-lists.
3. Use systemd template units for per-tenant service lifecycle.
4. Separate tenant data and runtime identity (unix user + state dir + ports).
5. Keep full audit logs for create/update/delete/provision actions.
6. Enforce budget guardrails and observability per tenant.

## Next Phases

### Phase 2
- Approval workflow for provisioning jobs (`queued -> approved -> running`).
- Two-person approval option for production/live jobs.
- Add explicit retry/cancel APIs.

### Phase 3
- Replace inline command execution with a dedicated root-owned provisioner daemon.
- Use signed job payloads and local socket communication.
- Add command policy engine and deny-by-default execution.

### Phase 4
- Full tenant lifecycle:
  - bootstrap
  - update plan
  - suspend/resume
  - decommission (safe archival + service teardown)

### Phase 5
- Tenant-level dashboards:
  - token usage and cost by model/agent/day
  - gateway/service health
  - SLA and incident timeline

## References
- sudoers man page: https://man7.org/linux/man-pages/man5/sudoers.5.html
- useradd man page: https://man7.org/linux/man-pages/man8/useradd.8.html
- systemd unit docs: https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html
- systemd exec hardening: https://www.freedesktop.org/software/systemd/man/254/systemd.exec.html
- systemd-run (transient units): https://www.freedesktop.org/software/systemd/man/256/systemd-run.html
- AWS SaaS tenant isolation: https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html
- AWS tenant isolation strategies: https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/identity-and-isolation.html
- NIST Zero Trust SP 800-207: https://www.nist.gov/publications/zero-trust-architecture
- OWASP access control: https://owasp.org/www-community/Access_Control
