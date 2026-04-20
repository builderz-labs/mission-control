# DarkMada — Diagrams

The canonical visual diagrams live **in the app** under the `/atlas` route. That's intentional: diagrams are
kept in the same repo as the architecture they describe, so they never drift. This folder is a pointer
layer for agents and readers who need the diagram set by name.

## Views (source: `src/app/atlas/`)

| Code | View | Route | Source |
|---|---|---|---|
| 01 | Full system overview | `/atlas/system` | [src/app/atlas/system/page.tsx](../../../src/app/atlas/system/page.tsx) |
| 02 | Execution flow | `/atlas/execution` | [src/app/atlas/execution/page.tsx](../../../src/app/atlas/execution/page.tsx) |
| 03 | Memory + data flow | `/atlas/memory` | [src/app/atlas/memory/page.tsx](../../../src/app/atlas/memory/page.tsx) |
| 04 | Agent org chart | `/atlas/org` | [src/app/atlas/org/page.tsx](../../../src/app/atlas/org/page.tsx) |
| 05 | MCP architecture | `/atlas/mcp` | [src/app/atlas/mcp/page.tsx](../../../src/app/atlas/mcp/page.tsx) |
| 06 | Runtime + model fabric | `/atlas/runtime` | [src/app/atlas/runtime/page.tsx](../../../src/app/atlas/runtime/page.tsx) |
| 07 | Compute + accounts | `/atlas/compute` | [src/app/atlas/compute/page.tsx](../../../src/app/atlas/compute/page.tsx) |
| 08 | Network + security | `/atlas/network` | [src/app/atlas/network/page.tsx](../../../src/app/atlas/network/page.tsx) |
| 09 | Future scale | `/atlas/scale` | [src/app/atlas/scale/page.tsx](../../../src/app/atlas/scale/page.tsx) |
| 10 | UI map | `/atlas/ui-map` | [src/app/atlas/ui-map/page.tsx](../../../src/app/atlas/ui-map/page.tsx) |

For exported PNGs of these views, see [`../screenshots/`](../screenshots/README.md).

## Primitives

Diagrams compose from a small set of primitives in [`src/components/atlas/primitives.tsx`](../../../src/components/atlas/primitives.tsx):

- `AtlasShell` — page frame with title + subtitle
- `Lane` — horizontal accent-coloured lane with child nodes
- `Node` — single labelled block with accent glow
- `Bus` — labelled horizontal connector between lanes
- `Legend` — accent key
