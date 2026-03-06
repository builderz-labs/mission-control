# X Feed Panel Redesign - Implementation Plan

**Created:** 2026-03-06  
**Status:** Ready for implementation

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

#### Task 3: Replace FilterSelect with PropertyChip imports
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Import PropertyChip: `import { PropertyChip } from '@/components/ui/property-chip'`
- [ ] Import Button: `import { Button } from '@/components/ui/button'`
- [ ] Import Tabs: `import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'`
- [ ] Import Lightbox: `import { Lightbox } from '@/components/ui/lightbox'`
- [ ] Remove the local FilterSelect component definition entirely

#### Task 4: Replace rating buttons with Button component
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Update RatingButton to use `<Button variant="ghost" size="xs">`
- [ ] Keep emoji content, remove raw `<button>` element
- [ ] Ensure active state styling works with Button component
- [ ] Test: clicking rating buttons should still update and visual feedback should work

#### Task 5: Replace FilterSelect with PropertyChip in filter bar
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Replace theme FilterSelect with PropertyChip:
  ```tsx
  <PropertyChip
    value={themeFilter}
    onSelect={setThemeFilter}
    options={themes.map(t => ({ value: t, label: t }))}
    placeholder="All Themes"
  />
  ```
- [ ] Replace rating FilterSelect with PropertyChip (keep emoji icons in labels)
- [ ] Replace digest FilterSelect with PropertyChip
- [ ] Remove empty value option — PropertyChip handles this automatically

#### Task 6: Replace "Load more" button with Button component
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Find the "Load more" `<button>` element
- [ ] Replace with: `<Button variant="outline" size="sm" onClick={handleLoadMore}>Load more ({tweets.length} of {total})</Button>`

### Phase 3: Curated Mode & State Management

#### Task 7: Add curated/all mode toggle state
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Add state: `const [mode, setMode] = useState<'curated' | 'all'>('curated')`
- [ ] Update fetchTweets to pass verdict filter:
  ```tsx
  if (mode === 'curated') params.set('verdict', 'curated')
  ```
- [ ] Add mode to fetchTweets dependencies: `[themeFilter, ratingFilter, digestFilter, search, mode]`

#### Task 8: Add Curated/All tabs UI
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Add tabs above filter bar (in header section):
  ```tsx
  <Tabs value={mode} onValueChange={(v) => setMode(v as 'curated' | 'all')}>
    <TabsList>
      <TabsTab value="curated">Curated</TabsTab>
      <TabsTab value="all">All</TabsTab>
    </TabsList>
  </Tabs>
  ```
- [ ] Test: switching tabs should trigger refetch with correct verdict filter

### Phase 4: Card Redesign (Always Expanded)

#### Task 9: Remove expand/collapse logic
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Remove `expandedId` state (no longer needed)
- [ ] Remove `onToggle` prop from TweetCard
- [ ] Remove the `expanded` prop and conditional rendering in TweetCard
- [ ] Remove click handler from card header button — convert to div

#### Task 10: Redesign card layout (always show content)
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [ ] Update card structure to always show full content:
  - Top row: `@username · time` (left) | pin + external link icons (right)
  - Content: full tweet text visible (no truncation, add `whitespace-pre-wrap` for formatting)
  - Media preview (if exists) — see Task 11
  - Thread indicator (if exists) — see Task 12
  - Footer: theme badge (left) | rating buttons (right)
- [ ] Remove border-t and pt-3 from content section (no longer conditional)
- [ ] Use Tailwind v3.4 syntax: `h-[var(--name)]` if needed for custom properties

#### Task 11: Add media preview support
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [ ] Parse `media_urls` (JSON string) at start of TweetCard:
  ```tsx
  const mediaUrls = tweet.media_urls ? JSON.parse(tweet.media_urls) : []
  const firstImage = mediaUrls[0]
  ```
- [ ] Add lightbox state: `const [lightboxImage, setLightboxImage] = useState<string | null>(null)`
- [ ] Render image preview if `firstImage` exists:
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
- [ ] Add Lightbox component at end of TweetCard:
  ```tsx
  {lightboxImage && <Lightbox imageUrl={lightboxImage} onClose={() => setLightboxImage(null)} />}
  ```

#### Task 12: Add thread indicator
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [ ] Check if content contains `---THREAD---`:
  ```tsx
  const hasThread = tweet.content.includes('---THREAD---')
  const [mainContent, threadContent] = hasThread 
    ? tweet.content.split('---THREAD---').map(s => s.trim())
    : [tweet.content, null]
  ```
- [ ] Render main content, then if thread exists:
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

#### Task 13: Update pinned and noise styling
**File:** `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- [ ] Replace ring styling for pinned tweets with left border:
  ```tsx
  className={`border border-border rounded-lg bg-card transition-all 
    ${isNoise ? 'opacity-40' : ''} 
    ${tweet.pinned ? 'border-l-4 border-l-amber-500' : ''} 
    ${focused ? 'ring-2 ring-primary/50' : ''}`}
  ```
- [ ] Remove ring-1 ring-amber-500/30 from pinned styling

### Phase 5: Header & Empty States

#### Task 14: Add stats to header
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Add state to track curated count: `const [curatedCount, setCuratedCount] = useState(0)`
- [ ] Update fetchTweets to fetch curated count when in "all" mode:
  ```tsx
  // After fetching tweets, if mode === 'all', fetch curated count:
  if (mode === 'all') {
    const curatedRes = await fetch('/api/xfeed?verdict=curated&limit=0')
    const curatedData = await curatedRes.json()
    setCuratedCount(curatedData.total)
  }
  ```
- [ ] Update header stats display:
  ```tsx
  {mode === 'curated' ? (
    <span>{total} curated</span>
  ) : (
    <span>{curatedCount} curated · {total} total</span>
  )}
  ```

#### Task 15: Add better empty states
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Replace current empty state with mode-aware version:
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
- [ ] Add handleResetFilters function:
  ```tsx
  const handleResetFilters = () => {
    setThemeFilter('')
    setRatingFilter('')
    setDigestFilter('')
    setSearch('')
  }
  ```

### Phase 6: Final Polish & Testing

#### Task 16: Update header refresh button to use Button component
**File:** `src/components/panels/xfeed-panel.tsx`
- [ ] Find any remaining raw `<button>` elements in header
- [ ] Replace with `<Button variant="outline" size="icon" onClick={fetchTweets} title="Refresh">` 
- [ ] Import icons if needed from iconoir-react

#### Task 17: Test dark mode styling
- [ ] Open app in browser, ensure dark theme is active
- [ ] Check all card colors: borders, backgrounds, text contrast
- [ ] Check PropertyChip dropdown colors in dark mode
- [ ] Check Tabs component colors
- [ ] Check Button hover states
- [ ] Check image borders and lightbox backdrop
- [ ] Fix any contrast or visibility issues

#### Task 18: Test keyboard navigation
- [ ] Arrow keys should still navigate between cards when nothing is expanded
- [ ] Enter on focused card should open external link
- [ ] Escape should clear focus
- [ ] Tab navigation should work through filter dropdowns and buttons

#### Task 19: Build and verify
- [ ] Run: `cd ~/Projects/mission-control && npx next build`
- [ ] Fix any TypeScript errors
- [ ] Fix any build warnings
- [ ] Verify build completes successfully

#### Task 20: Final acceptance check
- [ ] Default view shows only keep/kept tweets (curated mode) ✓
- [ ] Toggle switches between curated and all tweets ✓
- [ ] Cards show full content without clicking ✓
- [ ] Media previews render and open in lightbox ✓
- [ ] Thread content displays with thread badge ✓
- [ ] All buttons use `<Button>` component ✓
- [ ] All filters use `<PropertyChip>` component ✓
- [ ] Pinned tweets have amber left border ✓
- [ ] Noise-rated tweets dimmed to 40% ✓
- [ ] Empty states with reset/view-all buttons ✓
- [ ] Stats show curated vs total ✓

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
