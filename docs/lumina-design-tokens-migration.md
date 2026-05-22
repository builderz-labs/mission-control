# Migrating MC Fork to @lumina/design-tokens (D-T2)

Source: D-T2 (design-review JSONL) — "MC fork imports @lumina/design-tokens, removes own token CSS".

**Status:** scaffold + checklist landed. Full migration of all token-usage sites = follow-on work.

---

## Goal

Replace MC fork's own design tokens with `@lumina/design-tokens` (extracted from open-design v0.7.0). Single source of truth for MC fork + OD fork.

**Scope per design-review D3:** TOKEN-ONLY reskin. Do NOT change layout, IA, panel composition, navigation, or interaction patterns. Only swap visual primitives (colors, typography, spacing, radii, shadows, motion).

## Package linkage

`@lumina/design-tokens` lives in `openclaw/packages/lumina-design-tokens/` (after PR #344 merges to main).

### Option A: pnpm workspace
Requires repo restructure (single workspace spanning both repos).

### Option B: file: protocol (recommended for Phase 1)

`mission-control/package.json`:
```json
{
  "dependencies": {
    "@lumina/design-tokens": "file:../openclaw/packages/lumina-design-tokens"
  }
}
```

Trade-off: requires both repos in same parent dir; CI must clone both.

### Option C: npm pack + private registry
Most robust for prod CI/CD. Recommend for V1 demo.

**Recommendation:** Option B for Phase 1, migrate to C before V1 demo.

## Example import

```ts
// mission-control/src/styles/lumina-tokens-import.example.ts
import { tokens } from '@lumina/design-tokens';

const accentColor = tokens.colors.accent;
const headingFont = tokens.typography.heading.family;
const spaceLg = tokens.spacing.lg;

// As CSS string for runtime injection
import tokensCss from '@lumina/design-tokens/css';

// In Tailwind config
import { tokens } from '@lumina/design-tokens';
export default {
  theme: {
    extend: {
      colors: tokens.colors,
      fontFamily: { sans: [tokens.typography.body.family] },
      spacing: tokens.spacing,
      borderRadius: tokens.radii,
      boxShadow: tokens.shadows,
    },
  },
};
```

## Migration checklist

Run from `mission-control/`:
```bash
rg -l "var\(--" src/ | sort -u > /tmp/mc-token-sites.txt
rg -l "color:|background:|font-family:" src/styles/ | sort -u >> /tmp/mc-token-sites.txt
sort -u /tmp/mc-token-sites.txt | wc -l
```

Per file:
- [ ] Identify CSS variable (e.g., `var(--color-primary)`)
- [ ] Find corresponding token in `@lumina/design-tokens/src/tokens.ts`
- [ ] Import `@lumina/design-tokens/css` once at app entry
- [ ] If variable names differ between MC and OD, add per-token aliases in `src/styles/lumina-aliases.css`
- [ ] Visual smoke test

Suggested sweep order (high-traffic first):
1. `src/components/layout/*` — chrome
2. `src/components/buttons/*` — primitives
3. `src/components/cost-panel/*` — Phase 6 audit surface
4. `src/components/agents/*` — dashboard
5. `src/components/tasks/*` — task list
6. `src/components/memory/*` — memory view
7. `src/app/globals.css` + `src/styles/*.css`
8. `tailwind.config.ts`

## Validation

After each swap:
```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

Visual A/B per D-T4 (deferred until first MC deploy):
```bash
node scripts/visual-snapshot.ts --panels overview,agents,tasks,memory,cost --out tmp/before
# swap tokens
node scripts/visual-snapshot.ts --panels overview,agents,tasks,memory,cost --out tmp/after
node scripts/visual-diff.ts tmp/before tmp/after
```

D-T4 reference: `docs/artifacts/mc-token-reskin-visual-diff.md` (openclaw repo) — authored after first MC deploy succeeds.

## Rollback

If migration breaks prod:
1. Revert package.json to pre-Phase-2a commit
2. Delete `src/styles/lumina-aliases.css`
3. `pnpm install` falls back to bundled CSS
4. Deploy previous image SHA per `docs/runbooks/mc-rollback-rehearsal.md`

## Token coverage (D-T1 extracted 57 vars)

Covered by `@lumina/design-tokens`:
- colors (palette, surface, text, accent)
- typography (families, sizes, weights, line-heights)
- spacing (4-32 scale)
- radii (none/sm/md/lg/full)
- shadows (sm/md/lg)
- motion (durations + easings)
- layout (max-widths + breakpoints)

NOT covered (MC fork keeps in `src/styles/mc-only-tokens.css`):
- Z-index scale (MC stacking context)
- Component-specific tokens
- Dark-mode pairings (if MC has them and OD doesn't)

## Exit criteria for D-T2 full migration

- [ ] `@lumina/design-tokens` linked (Option B minimum)
- [ ] At least one example component imports + uses tokens
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:e2e` passes
- [ ] 5-panel visual A/B (D-T4) shows no unintended regressions
- [ ] CHANGELOG.md updated
- [ ] UPSTREAM.md "Divergence inventory" row updated for tokens + tailwind

Phase 2a COMPLETE when all checked.

---

## Phase 2a — .lumina theme class shipped (2026-05-19)

**Status:** SHIPPED on branch `lumina/phase-2a-tokens`.

The first slice of D-T2 — a `.lumina { ... }` theme class in `src/app/globals.css` — is live. This shipped *without* the package linkage (Option B/C above), instead consuming Lumina hex values inline via the shadcn HSL-triplet pattern that the existing 11 themes already use.

**Why inline, not @import:**
- MC's theme system is HSL-triplet-driven (e.g. `--background: 215 27% 4%;` consumed via `hsl(var(--background))`). OD's tokens.css uses raw hex (`--bg: #070810`). The two shapes do not compose without a translation layer.
- `.lumina` in `globals.css` is the translation layer. It reads the canonical Lumina brand values from `@lumina/design-tokens` v0.1.0 (in `openclaw/packages/lumina-design-tokens/`) and re-encodes them as HSL triplets that MC's theme switcher and shadcn primitives can consume.
- Change-management contract: brand-shaping changes happen FIRST in `@lumina/design-tokens` (where the design owner reviews), then mirror into `.lumina` here.

### Hex → HSL conversion table

Computed via deterministic `Node.js` `hexToHsl()` script (committed in PR description for audit). All triplets follow shadcn's `H S% L%` shape — no `hsl()` wrapper inside the var value.

| Lumina token | Hex | HSL triplet | MC var |
|---|---|---|---|
| Lumina Ink | `#070810` | `233 39% 5%` | `--background`, `--surface-0` |
| Surface Slate | `#131627` | `231 34% 11%` | `--card`, `--popover`, `--surface-2` |
| Ink Tint | `#0C0E1A` | `231 37% 7%` | `--secondary`, `--surface-1` |
| Warm Cream | `#F0EDE5` | `44 27% 92%` | `--foreground`, `--card-foreground` |
| Smoke | `#8A909E` | `222 9% 58%` | `--muted-foreground` |
| Slate Subtle | `#4A5068` | `228 17% 35%` | base for `--void-violet` |
| Gilded Gold | `#C4963A` | `40 54% 50%` | `--primary`, `--ring`, `--info`, `--void-cyan`, `--void-amber` |
| Champagne Hover | `#E8C06A` | `41 73% 66%` | `--void-mint` |

### Files changed

| File | Change |
|---|---|
| `src/app/globals.css` | Added `.lumina { ... }` block (~83 lines) after `.paper`, before themed-backgrounds section |
| `src/lib/themes.ts` | Registered `{ id: 'lumina', label: 'Lumina', group: 'dark', swatch: '#C4963A' }` in `THEMES` array |
| `docs/lumina-design-tokens-migration.md` | This section |

### Verification

- `grep -n '^\.lumina ' src/app/globals.css` — finds the new class
- `grep -n "'lumina'" src/lib/themes.ts` — finds the registry entry
- `pnpm typecheck` — passes (themes.ts has correct ThemeMeta shape)

### Default theme per tenant

`NEXT_PUBLIC_DEFAULT_THEME=lumina` is the env-driven default. Each `/opt/mc-{T}/.env` on Hetzner sets this to bias the first-load theme. Users can still switch via the theme picker; the env value only controls the first-paint default.

### What still ships at Phase 2 maturity

This Phase-2a slice is the runtime-visible reskin: the moment a user toggles to the Lumina theme, every shadcn primitive (Button, Card, Popover, Input, focus rings, semantic states) inherits Lumina brand colors via `hsl(var(--*))` indirection. No layout, IA, or interaction patterns change — per design-review D3, this is TOKEN-ONLY.

Follow-on slices (deferred):
- **Option B linkage**: `package.json` adds `"@lumina/design-tokens": "file:../openclaw/packages/lumina-design-tokens"` so the package is queryable from MC TS code (useful for charts, SVG, JS-driven motion).
- **Typography mapping**: Cormorant Garamond + Inter aren't yet wired in MC's font stack — currently the theme only swaps colors. Font swap is the next slice.
- **D-T4 visual diff**: 5-panel before/after snapshots, scripted via Playwright per docs/artifacts/mc-token-reskin-visual-diff.md.
