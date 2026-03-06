# X Feed Panel Redesign

## Overview
Redesign the X Feed panel to hide noise by default, show only quality tweets, and display them as rich, well-designed cards with media previews and better information hierarchy.

## Current Problems
- Shows ALL 1849 tweets including unclassified and dropped noise
- Cards are collapsed by default — you have to click each one to see content
- No media previews (images exist in `media_urls` column but aren't shown)
- Raw `<button>` and `<select>` elements everywhere (not using project components)
- Verdict filter exists but defaults to showing everything
- "Dropped" appears both as a verdict AND a theme — confusing

## Requirements

### 1. Default Filtering
- **Default view: show only "keep" and "kept" verdicts** — the curated feed
- Hide: "drop", "dropped", "borderline", unclassified (NULL/empty verdict)
- Add a toggle or tab to switch between "Curated" (keep/kept only) and "All"
- Remember the user's filter preference in the session

### 2. Card Redesign — Always Expanded
Stop collapsing cards. Every card should show its content by default. The current click-to-expand pattern adds friction for a reading experience.

**Card layout:**
```
┌─────────────────────────────────────────────┐
│ @author · 2h ago                    📌 🔗   │
│                                              │
│ Tweet content / title text here that can     │
│ wrap to multiple lines naturally...          │
│                                              │
│ ┌──────────┐                                 │
│ │  image   │  (if media_urls has content)    │
│ │ preview  │                                 │
│ └──────────┘                                 │
│                                              │
│ [AI/LLM]  [🔥] [😐] [🗑️]                   │
└─────────────────────────────────────────────┘
```

**Specific design:**
- **Author line:** `@username` in medium weight + relative time in muted text, right-aligned: pin icon + external link icon
- **Content:** Full tweet text visible (no truncation for normal tweets, `line-clamp-6` for very long threads). Use `text-sm text-foreground` with good line height.
- **Media preview:** If `media_urls` is non-empty, parse the JSON array and show the first image as a rounded thumbnail (max-height 200px, full width, `object-cover`). Click to open full-size in new tab.
- **Thread indicator:** If content contains `---THREAD---`, show a subtle "🧵 Thread" badge and render the thread content below the main tweet separated by a thin divider.
- **Footer row:** Theme badge (left) + rating buttons (right). Keep the existing rating system (🔥/😐/🗑️) but use `<Button>` component with ghost variant.
- **Pinned tweets:** Subtle amber left border instead of a ring
- **Noise-rated tweets:** Dim to 40% opacity

### 3. Replace Raw HTML Elements
- All `<button>` → `<Button>` component
- All `<select>` (FilterSelect) → `PropertyChip` component
- "Load more" button → `<Button>` variant="outline" size="sm"

### 4. Filter Bar Redesign
- Replace the FilterSelect components with PropertyChip components
- Add a "Curated / All" toggle at the start (two buttons, like the Board/List toggle in tasks)
- Filters: Theme, Rating, Digest, Search
- Show active filter count as a badge

### 5. Better Empty States
- "No tweets match your filters" with a button to reset filters
- "Your curated feed is empty" when in curated mode with no keep/kept tweets

### 6. Stats in Header
- Show: "{count} tweets" next to the title
- In curated mode: "{kept_count} curated · {total} total"

## Technical Notes
- Panel file: `src/components/panels/xfeed-panel.tsx`
- DB query in `src/lib/cc-db.ts` → `getTweets()` — may need a new default filter parameter
- `media_urls` column contains JSON arrays of image URLs (e.g. `["https://pbs.twimg.com/..."]`)
- Thread content is in the `content` field, separated by `---THREAD---`
- **Tailwind v3.4** — bracket syntax
- Use `<Button>` component for all buttons
- Use `PropertyChip` for all filter dropdowns
- Images: use `<img>` with `rounded-lg object-cover` and lazy loading (`loading="lazy"`)

## Acceptance Criteria
- [ ] Build passes (`npx next build`)
- [ ] Default view shows only keep/kept tweets (curated mode)
- [ ] Toggle switches between curated and all tweets
- [ ] Cards show full content without needing to click/expand
- [ ] Media previews render from `media_urls` (first image as thumbnail)
- [ ] Thread content (after `---THREAD---`) displays with thread badge
- [ ] All `<button>` replaced with `<Button>` component
- [ ] All `<select>` replaced with `PropertyChip` component
- [ ] Rating buttons use `<Button>` ghost variant
- [ ] Pinned tweets have amber left border
- [ ] Noise-rated tweets dimmed
- [ ] Filter bar works: theme, rating, digest, search
- [ ] Empty states with reset button
- [ ] Dark mode correct
- [ ] Keyboard navigation still works (arrow keys to navigate, Enter to open on X)
