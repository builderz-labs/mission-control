# Release Process

This repository uses Semantic Versioning (SemVer): `MAJOR.MINOR.PATCH`.

- MAJOR: breaking API/behavior changes
- MINOR: backward-compatible features
- PATCH: backward-compatible fixes

## Branch Strategy

- `main` is the integration branch and must stay green.
- PRs merge into `main` after passing quality gates.
- Official releases are cut from `main` and tagged `vX.Y.Z`.
- Hotfixes also merge via PR into `main`, then receive a PATCH tag.

We intentionally keep a trunk-based workflow (no long-lived `develop` branch) to reduce merge drift.

## Required Gates Before Release

1. CI quality gate passes (lint/typecheck/tests/build)
2. Security-sensitive changes reviewed
3. API contract parity checks pass
4. Release notes/changelog summary prepared

## Tagging and Publishing

Create an annotated tag from `main`:

```bash
git checkout main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "release: vX.Y.Z"
git push origin vX.Y.Z
```

On push to `v*.*.*`, GitHub Actions publishes container images and release artifacts.

## Compatibility and Deprecation

- Any route removal or contract-breaking change must be documented in PR notes and release notes.
- Keep deprecation windows when practical (aliases/shims) before full removal.
- Include migration guidance for env vars, config paths, and API consumers.

## Release Checklist

- [ ] Version decision (major/minor/patch) agreed
- [ ] `main` green and up to date
- [ ] Breaking changes called out (if any)
- [ ] Upgrade notes written
- [ ] Tag `vX.Y.Z` created and pushed
- [ ] Container image availability verified (`ghcr.io/builderz-labs/mission-control`)
