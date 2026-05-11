# Fork Policy — stroupaloop/mission-control

**This repo is a PRIVATE fork of [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control).**

## Hard Rules

1. **NEVER open a PR to `builderz-labs/mission-control`** from this fork. Not a single line. Not "just a typo fix." Not anything.
2. **All customizations live in `src/extensions/`.** Only five upstream files may be touched:
   - `src/lib/db.ts` — to call `mountExtensions()`
   - `src/app/layout.tsx` — to render `<ClientBoot />`
   - `src/proxy.ts` — to allowlist server-to-server ingest endpoints (`/api/litellm/usage`) that authenticate via per-route bearer tokens instead of the session/API_KEY model
   - `src/i18n/request.ts` — to call `loadExtensionMessages(locale)` so extension namespaces (`oapApprovals`, `litellmUsage`, etc.) merge into the next-intl bag without appending to upstream `messages/*.json`
   - `src/components/layout/nav-rail.tsx` — to map extension-manifest icon-name strings to SVG components via `resolvePluginIcon()` (extension manifests can only carry string icon names; the mapping to React nodes lives client-side)
   Any change outside these paths requires explicit owner approval. See `EXTENSIONS.md` for the canonical table.

   **Long-term direction for `src/proxy.ts`:** the public-paths allowlist should be derived from `loadExtensionManifest()` (e.g. a `bypassProxyAuth?: string[]` field per extension) so adding new ingest endpoints stays inside `src/extensions/`. Until that hook exists, the touch is owner-approved on a case-by-case basis.
3. **Workflows in `.github/workflows/` guard with `if: github.repository == 'stroupaloop/mission-control'`** so they no-op if the file ever leaks upstream.
4. **Docker images push only to `ghcr.io/stroupaloop/mission-control`.** Never to `builderz-labs` or any public namespace.

## Why This Fork Exists

AMS Global Ventures has proprietary integrations that plug into Mission Control:
- Resolver Intelligence (tool-resolver telemetry + overrides)
- OAP (audit + approvals bridge)
- LiteLLM (cost attribution + usage)
- MCP (audit pipeline)
- Security Audit (scheduled scans)

These are business-specific and not for upstream contribution.

## Rebasing Upstream

When a new upstream release drops:
1. Fetch `upstream/main`
2. Rebase `main` (our fork's main) onto `upstream/main`
3. Resolve conflicts — should be minimal because all our code is in `src/extensions/`
4. Rebuild Docker image, re-verify panels in browser
5. Tag and push to GHCR

## Contacts

Owner: Andrew (stroupaloop)
Agent: Ender Wiggin — COS; maintains this fork on Andrew's behalf
