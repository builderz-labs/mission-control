---
summary: "Tracks every change made to upstream mission-control files"
read_when:
  - "Merging upstream mission-control changes"
  - "Resolving merge conflicts"
  - "Auditing fork divergence"
---

# Upstream Patches

Every modification to a file that exists in `builderz-labs/mission-control` is
documented here. During upstream merges, check this file to know where conflicts
will occur and how to resolve them.

## Active Patches

### 1. `src/nav-rail.tsx`
**Purpose**: Add LIONROOT nav group
**Lines changed**: +2 (import + group append)
**Merge resolution**: Re-apply after any upstream nav-rail restructure

```diff
+ import { lionrootNavGroup } from './components/panels/lionroot/nav-config'
  // ... at end of navGroups array:
+ lionrootNavGroup,
```

### 2. `src/page.tsx`
**Purpose**: Route Lionroot panel tabs through our router
**Lines changed**: +3 (import + router call)
**Merge resolution**: Re-apply after any ContentRouter changes

```diff
+ import { LionrootContentRouter } from './components/panels/lionroot/router'
  // In ContentRouter, before default case:
+ const lionrootPanel = LionrootContentRouter(activeTab)
+ if (lionrootPanel) return lionrootPanel
```

### 3. `src/lib/migrations.ts`
**Purpose**: Include Lionroot DB migrations (numbered 100+)
**Lines changed**: +2 (import + spread)
**Merge resolution**: Re-apply after any migration runner changes

```diff
+ import { lionrootMigrations } from './lionroot/migrations'
  // After migrations array:
+ const allMigrations = [...migrations, ...lionrootMigrations]
```

### 4. `.env.example`
**Purpose**: Document Lionroot-specific environment variables
**Lines changed**: +12
**Merge resolution**: Append section — no conflict expected

---

## Retired Patches

(Patches that were merged upstream or no longer needed)

*None yet.*
