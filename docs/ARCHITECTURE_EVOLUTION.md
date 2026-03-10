# Architecture Evolution

## Policy
- Preserve working systems before expanding scope.
- Prefer new routes, adapters, and manifests over destructive rewrites.
- Split modules into separate repositories only after interfaces and responsibilities are stable.
- Keep the registry and decisions log synchronized with structural changes.

## Current Evolution Stage
Bootstrap stage: one writable repo hosting the first Marcuzx Forge MVP with clear module seams for future extraction.
