# DarkMada — Internal

The canonical internal documentation package for DarkMada, Jackson's modular AI operating system.

This directory is the single source of human + agent-readable architecture knowledge. Keep it coherent.
Nothing in this folder carries legacy naming.

## Layout

```
docs/darkmada-internal/
├── architecture/   System architecture — read 00 → 10 in order
├── agents/         Per-agent role docs + roster
├── integration/    Briefs written for OpenClaw / Helmy ingest
├── diagrams/       Pointers to the in-app System Atlas (source of truth for visuals)
├── screenshots/    Rendered captures of every surface + atlas page
└── README.md       (this file)
```

## Entry points

- **Human reader**: [`architecture/00-overview.md`](architecture/00-overview.md).
- **Agent ingest (OpenClaw, Helmy)**: [`integration/openclaw-system-brief.md`](integration/openclaw-system-brief.md).
- **Visual learner**: run the app and visit [`/atlas`](http://localhost:3000/atlas).

## Naming rule

Only one canonical internal identity is used in this package:

> **DarkMada — Internal**

All prior naming (Mission Control v3, Oracle Stack v3, etc.) has been removed. Do not reintroduce layered
naming — one coherent identity only.

The underlying repo on disk is still `builderz-labs/mission-control` as a package name for the OSS baseline,
but nothing inside this documentation refers to it as a system-level identity. The system is DarkMada.
