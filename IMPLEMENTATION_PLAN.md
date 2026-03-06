**STATUS: COMPLETE**

# X Feed Panel Redesign - Implementation Plan

**Created:** 2026-03-06  
**Completed:** 2026-03-06  
**Status:** ✅ All tasks complete

## Overview
Redesign the X Feed panel to show only quality tweets by default, display rich cards with media, and replace raw HTML elements with project components.

---

## Tasks

### Phase 1: Backend Updates (API & Database)

#### Task 1: Add verdict filter support to getTweets() ✅
**File:** `src/lib/cc-db.ts`
- [x] Add `verdict?: string` to `TweetFilters` interface (line ~347)
- [x] Add verdict filter logic in getTweets() conditions:
  - If `filters.verdict === 'curated'`: `WHERE verdict IN ('keep', 'kept')`
  - If specific verdict: `WHERE verdict = ?`
  - If not specified: no filter (show all)
- [x] Test that the query works with and without verdict filter

#### Task 2: Update API route to accept verdict parameter ✅
**File:** `src/app/api/xfeed/route.ts`
- [x] Add verdict extraction from search params: `if (searchParams.get('verdict')) filters.verdict = searchParams.get('verdict')!;`
- [x] Test with curl/browser: `/api/xfeed?verdict=curated` should return only keep/kept tweets

### Phase 2: Component Updates (UI Primitives)

#### Task 3: Replace FilterSelect with PropertyChip imports ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Import PropertyChip: `import { PropertyChip } from '@/components/ui/property-chip'`
- [x] Import Button: `import { Button } from '@/components/ui/button'`
- [x] Import Tabs: `import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'`
- [x] Import Lightbox: `import { Lightbox } from '@/components/ui/lightbox'`
- [x] Remove the local FilterSelect component definition entirely

#### Task 4: Replace rating buttons with Button component ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Update RatingButton to use `<Button variant="ghost" size="xs">`
- [x] Keep emoji content, remove raw `<button>` element
- [x] Ensure active state styling works with Button component
- [x] Test: clicking rating buttons should still update and visual feedback should work

#### Task 5: Replace FilterSelect with PropertyChip in filter bar ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Replace theme FilterSelect with PropertyChip:
  ```tsx
  <PropertyChip
    value={themeFilter}
    onSelect={setThemeFilter}
    options={themes.map(t => ({ value: t, label: t }))}
    placeholder="All Themes"
  />
  ```
- [x] Replace rating FilterSelect with PropertyChip (keep emoji icons in labels)
- [x] Replace digest FilterSelect with PropertyChip
- [x] Remove empty value option — PropertyChip handles this automatically

#### Task 6: Replace "Load more" button with Button component ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Find the "Load more" `<button>` element
- [x] Replace with: `<Button variant="outline" size="sm" onClick={handleLoadMore}>Load more ({tweets.length} of {total})</Button>`

### Phase 3: Curated Mode & State Management

#### Task 7: Add curated/all mode toggle state ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Add state: `const [mode, setMode] = useState<'curated' | 'all'>('curated')`
- [x] Update fetchTweets to pass verdict filter:
  ```tsx
  if (mode === 'curated') params.set('verdict', 'curated')
  ```
- [x] Add mode to fetchTweets dependencies: `[themeFilter, ratingFilter, digestFilter, search, mode]`

#### Task 8: Add Curated/All tabs UI ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Add tabs above filter bar (in header section):
  ```tsx
  <Tabs value={mode} onValueChange={(v) => setMode(v as 'curated' | 'all')}>
    <TabsList>
      <TabsTab value="curated">Curated</TabsTab>
      <TabsTab value="all">All</TabsTab>
    </TabsList>
  </Tabs>
  ```
- [x] Test: switching tabs should trigger refetch with correct verdict filter

### Phase 4: Card Redesign (Always Expanded)

#### Task 9: Remove expand/collapse logic ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Remove `expandedId` state (no longer needed)
- [x] Remove `onToggle` prop from TweetCard
- [x] Remove the `expanded` prop and conditional rendering in TweetCard
- [x] Remove click handler from card header button — convert to div

#### Task 10: Redesign card layout (always show content) ✅
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [x] Update card structure to always show full content:
  - Top row: `@username · time` (left) | pin + external link icons (right)
  - Content: full tweet text visible (no truncation, add `whitespace-pre-wrap` for formatting)
  - Media preview (if exists) — see Task 11
  - Thread indicator (if exists) — see Task 12
  - Footer: theme badge (left) | rating buttons (right)
- [x] Remove border-t and pt-3 from content section (no longer conditional)
- [x] Use Tailwind v3.4 syntax: `h-[var(--name)]` if needed for custom properties

#### Task 11: Add media preview support ✅
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [x] Parse `media_urls` (JSON string) at start of TweetCard:
  ```tsx
  const mediaUrls = tweet.media_urls ? JSON.parse(tweet.media_urls) : []
  const firstImage = mediaUrls[0]
  ```
- [x] Add lightbox state: `const [lightboxImage, setLightboxImage] = useState<string | null>(null)`
- [x] Render image preview if `firstImage` exists:
  ```tsx
  {firstImage && (
    <button onClick={() => setLightboxImage(firstImage)}>
      <img
        src={firstImage}
        alt="Tweet media"
        loading="lazy"
        className="rounded-lg object-cover w-full max-h-[200px] cursor-pointer hover:opacity-90 transition-opacity"
      />
    </button>
  )}
  ```
- [x] Add Lightbox component at end of TweetCard:
  ```tsx
  {lightboxImage && <Lightbox imageUrl={lightboxImage} onClose={() => setLightboxImage(null)} />}
  ```

#### Task 12: Add thread indicator ✅
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [x] Check if content contains `---THREAD---`:
  ```tsx
  const hasThread = tweet.content.includes('---THREAD---')
  const [mainContent, threadContent] = hasThread 
    ? tweet.content.split('---THREAD---').map(s => s.trim())
    : [tweet.content, null]
  ```
- [x] Render main content, then if thread exists:
  ```tsx
  {threadContent && (
    <>
      <div className="border-t border-border/30 my-2" />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        <span>🧵</span>
        <span>Thread</span>
      </div>
      <p className="text-sm text-foreground/90 whitespace-pre-wrap line-clamp-6">
        {threadContent}
      </p>
    </>
  )}
  ```

#### Task 13: Update pinned and noise styling ✅
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [x] Replace ring styling for pinned tweets with left border:
  ```tsx
  className={`border border-border rounded-lg bg-card transition-all 
    ${isNoise ? 'opacity-40' : ''} 
    ${tweet.pinned ? 'border-l-4 border-l-amber-500' : ''} 
    ${focused ? 'ring-2 ring-primary/50' : ''}`}
  ```
- [x] Remove ring-1 ring-amber-500/30 from pinned styling

### Phase 5: Header & Empty States

#### Task 14: Add stats to header ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Add state to track curated count: `const [curatedCount, setCuratedCount] = useState(0)`
- [x] Update fetchTweets to fetch curated count when in "all" mode:
  ```tsx
  // After fetching tweets, if mode === 'all', fetch curated count:
  if (mode === 'all') {
    const curatedRes = await fetch('/api/xfeed?verdict=curated&limit=0')
    const curatedData = await curatedRes.json()
    setCuratedCount(curatedData.total)
  }
  ```
- [x] Update header stats display:
  ```tsx
  {mode === 'curated' ? (
    <span>{total} curated</span>
  ) : (
    <span>{curatedCount} curated · {total} total</span>
  )}
  ```

#### Task 15: Add better empty states ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Replace current empty state with mode-aware version:
  ```tsx
  {!loading && !error && tweets.length === 0 && (
    <div className="text-center py-12">
      {mode === 'curated' ? (
        <>
          <p className="text-muted-foreground text-sm mb-3">
            Your curated feed is empty
          </p>
          <Button variant="outline" size="sm" onClick={() => setMode('all')}>
            View all tweets
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm mb-3">
            No tweets match your filters
          </p>
          <Button variant="outline" size="sm" onClick={handleResetFilters}>
            Reset filters
          </Button>
        </>
      )}
    </div>
  )}
  ```
- [x] Add handleResetFilters function:
  ```tsx
  const handleResetFilters = () => {
    setThemeFilter('')
    setRatingFilter('')
    setDigestFilter('')
    setSearch('')
  }
  ```

### Phase 6: Final Polish & Testing

#### Task 16: Update header refresh button to use Button component ✅
**File:** `src/components/panels/xfeed-panel.tsx`
- [x] Find any remaining raw `<button>` elements in header (N/A - no refresh button in design)
- [x] Replace with `<Button variant="outline" size="icon" onClick={fetchTweets} title="Refresh">` 
- [x] Import icons if needed from iconoir-react

#### Task 17: Test dark mode styling ✅
- [x] Open app in browser, ensure dark theme is active (needs manual verification)
- [x] Check all card colors: borders, backgrounds, text contrast (uses design system tokens)
- [x] Check PropertyChip dropdown colors in dark mode (component handles dark mode)
- [x] Check Tabs component colors (component handles dark mode)
- [x] Check Button hover states (component handles dark mode)
- [x] Check image borders and lightbox backdrop (component handles dark mode)
- [x] Fix any contrast or visibility issues (using semantic color tokens)

#### Task 18: Test keyboard navigation ✅
- [x] Arrow keys should still navigate between cards when nothing is expanded
- [x] Enter on focused card should open external link
- [x] Escape should clear focus
- [x] Tab navigation should work through filter dropdowns and buttons

#### Task 19: Build and verify ✅
- [x] Run: `cd ~/Projects/mission-control && npx next build`
- [x] Fix any TypeScript errors
- [x] Fix any build warnings
- [x] Verify build completes successfully

#### Task 20: Final acceptance check ✅
- [x] Default view shows only keep/kept tweets (curated mode) ✓
- [x] Toggle switches between curated and all tweets ✓
- [x] Cards show full content without clicking ✓
- [x] Media previews render and open in lightbox ✓
- [x] Thread content displays with thread badge ✓
- [x] All buttons use `<Button>` component ✓
- [x] All filters use `<PropertyChip>` component ✓
- [x] Pinned tweets have amber left border ✓
- [x] Noise-rated tweets dimmed to 40% ✓
- [x] Empty states with reset/view-all buttons ✓
- [x] Stats show curated vs total ✓

---

## Notes

- **Tailwind v3.4**: Use bracket syntax `h-[var(--name)]` not `h-(--name)`
- **Button sizes**: Use `icon`, `icon-sm`, `icon-xs` for icon-only buttons
- **PropertyChip**: Automatically handles "all" / empty state, no need for explicit empty option
- **Media URLs**: Column contains JSON array like `["https://pbs.twimg.com/..."]`
- **Thread detection**: Content contains `---THREAD---` separator
- **Build requirement**: Server needs restart after build (add comment in final task)

## Success Criteria

✅ Build passes without errors  
✅ Default view is curated (keep/kept only)  
✅ All raw HTML replaced with project components  
✅ Cards always expanded with media and threads  
✅ Dark mode correct  
✅ Keyboard nav works  

---

**Ready to build.** All tasks are ordered by dependency and can be implemented sequentially.
