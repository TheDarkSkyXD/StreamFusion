# Candidate A: category items in the existing refreshable FlatList

## Problem

`CategoriesView` mounts every popular card inside `MobileRefreshableScroll`, and checks the last 240 pixels on throttled scroll events. `useCategoryCatalog` collapses provider pages and calls `composeCategoryCatalog` on every hook render. These costs grow with loaded pages. Keep category identity, merged viewer ordering, provider selection, remote search, stale-cache recovery, and existing cards intact.

Grounded files: `categories-screen.tsx`, `use-category-catalog.ts`, `category-catalog.ts`, `category-card.tsx`, `design/refreshable.tsx`, and `home-live-discovery-screen.tsx`. The Home list already uses `MobileRefreshableFlatList` with a bounded window. The category hook already protects each provider with `hasNextPage && !isFetching` and `fetchNextPage({ cancelRefetch: false })`.

## Usage

Popular renders category items directly. Existing search, tabs, filters, language, proof controls, provider banners, and phase copy form the scrolling header. Loading skeletons belong in the empty slot. The spinner and manual Load more button remain in the footer.

```tsx
const catalog = useCategoryCatalog({ preferences, query, session });
// Provider selection remains presentation state; cached pages remain available.
<CategoriesView
  view={catalog.view}
  platform={platform}
  canLoadMore={selectedProviderCanLoadMore}
  refreshing={catalog.refreshing}
  onLoadMore={() => catalog.loadMore(platform)}
  // Existing interaction props remain unchanged.
/>
```

```tsx
<MobileRefreshableFlatList<CatalogCategory>
  listRef={listRef}
  data={visibleCategories}
  numColumns={2}
  keyExtractor={categoryKey}
  renderItem={renderCategory}
  ListHeaderComponent={header}
  ListEmptyComponent={empty}
  ListFooterComponent={footer}
  columnWrapperStyle={styles.columns}
  ItemSeparatorComponent={CategoryRowGap}
  onEndReached={loadNextVisiblePage}
  onEndReachedThreshold={0.5}
  onRefresh={onRefresh}
  refreshing={refreshing}
  initialNumToRender={6}
  maxToRenderPerBatch={6}
  windowSize={5}
/>
```

```tsx
useEffect(() => {
  listRef.current?.scrollToOffset({ offset: 0, animated: false });
}, [platform, view.query]);
```

These are design sketches, not implemented code. Rendering settings are provisional bounded defaults to verify on the real phone, not benchmark conclusions.

## Shape

No new feature or remote-state owner. Keep the hook as the query boundary and the view as the rendering boundary. Retain existing domain functions.

```ts
// Existing public contract, retained.
type CategoryCatalogView = {
  readonly phase: HomeLiveDiscoveryPhase;
  readonly categories: readonly CatalogCategory[];
  readonly language: LanguageFilter;
  readonly query: string;
  readonly providers: Readonly<Record<Platform, PlatformReadOutcome<Category>>>;
  readonly retryablePlatforms: readonly Platform[];
};

// Existing design primitive gets one native-ref adaptation.
type MobileRefreshableFlatListProps<ItemT> = FlatListProps<ItemT> & {
  readonly onRefresh?: MobileRefreshHandler | undefined;
  readonly listRef?: Ref<FlatList<ItemT>> | undefined;
};
function MobileRefreshableFlatList<ItemT>(
  props: MobileRefreshableFlatListProps<ItemT>,
): ReactNode { throw new Error('not implemented'); }

// Feature-private helpers remain in categories-screen.tsx.
function categoryKey(category: CatalogCategory): string {
  throw new Error('not implemented');
}
function CategoryRowGap(): ReactElement {
  throw new Error('not implemented');
}
```

Memoize Twitch and Kick collapsed outcomes independently on their `data.pages` references. Memoize `composeCategoryCatalog` on those collapsed outcomes, remote result references, language, raw query, and initial loading state. Never depend on the whole query-result object; fetching flags would invalidate the memo on status-only renders. Memoize the visible provider projection on category and provider-item references plus selected platform, rather than the complete view object. TanStack Query remains the owner of requests and pages. No mutable mirror or incremental merge index is introduced, per foundational-thinking and laziness-protocol.

The dominant access path is query pages to collapsed outcomes to catalog categories to the selected provider's visible array to FlatList cells. Existing identity keys remain `platform:id`. Clicking a cell still calls `identityFromCategory` before navigation. No cursor or transport type enters the list API, per boundary-discipline.

`onEndReached` calls the existing callback only for Popular, when `canLoadMore` is true and `refreshing` is false. Keep the hook's provider guard and `cancelRefetch: false` as the final protection against repeated callbacks before React updates. All mode advances eligible providers; a selected provider advances only itself. Preserve the manual button as an accessible fallback. Do not add a momentum lock, a second page cache, or a request latch unless observed behavior shows the existing query guard is insufficient.

Search and provider changes reset the visible scroll position through a ref, without deleting loaded pages or re-keying provider queries. Raw query belongs in the reset dependencies so one-character local searches reset too. Never key the entire FlatList by query: its header includes the search input, so that remount would interrupt focus while typing. Tab changes unmount the old body and enter the other body at its start. Language does not filter the category catalog today, so it does not require a pagination reset.

## Followed tab and styles

For the smallest fix, retain Followed's current refreshable ScrollView branch and existing `useFollowingView` ownership. Build the shared header node once and place it in either branch. Do not put `FollowedCategories` in the popular FlatList's header or footer; that would still mount its whole card grid and obscure which branch is virtualized. Popular pagination must never run on Followed. Followed's art fallback, retry, and identity behavior remain unchanged. Its current all-mounted grid is a separate limitation, not solved by this scoped popular-catalog change.

Both cards already use `width: '48%'`. Render `CategoryCard` directly into each FlatList row. `columnWrapperStyle` uses `justifyContent: 'space-between'`, preserving the effective 4% gutter without a row wrapper that would make the card 48% of a second cell. Keep the 3:4 artwork, token typography, padding, and test IDs. Remove `flexWrap` from the popular list. Move content-wide `gap` into the header/footer and use a row separator for vertical spacing. Do not provide fixed `getItemLayout`: titles and viewer metadata produce variable row heights.

## Synthesis decision

Candidate A recommends native `numColumns={2}` as the base. Final cross-candidate synthesis belongs to the parent agent.

## Tradeoffs accepted

- Full merge and sort still occur when provider pages or search results change. Memoization removes redundant work without rewriting domain rules.
- Variable-height rows use native measurement. This keeps card appearance and avoids guessed item heights.
- Followed retains its existing grid. This keeps the fix focused on the unbounded paged popular catalog.
- Imperative scroll reset adds a narrow ref prop to the existing primitive. It preserves the scrolling header and search focus.

## Alternatives considered

A manually paired row virtualizer would expose row construction, odd-item slots, row keys, and width ownership to the screen. It can hide measurement inside a list but adds a second representation of category items. Native two-column FlatList already owns those concerns behind the existing primitive. A custom viewport calculation would additionally own native scroll geometry and recycling policy, so it loses on interface depth.

A unified Popular/Followed item list would remove Followed's remaining all-mounted grid, but requires lifting its query/projection or extracting a second hooked list. That is wider than the smallest fix. Revisit if Followed is independently shown to have the same problem.

## Verification and risks

Existing `catalog-ui-journeys.test.ts` expands FlatList slots but calls `CategoriesView` as a plain function. A view that adds `useMemo`, `useRef`, and `useEffect` needs a real React mount harness for its journey tests; do not mock those hooks into no-ops and claim reset behavior is covered.

Verify real provider identity when pressing a Kick projection, retained loaded cards during refresh, loading and empty slots, search focus through multiple keystrokes, provider/search scroll reset, automatic end pagination, and manual fallback. A hook test should hold a next-page request unresolved and exercise repeated load requests, checking that only one request starts and the previous page remains. Cover provider exhaustion and ensure Followed cannot invoke Popular pagination. Preserve existing pagination and recovery tests.

Which bounded rendering settings avoid visible blank rows on the Android device? Does appending newly sorted pages move existing cards enough to need later ordering work? These are observation questions for implementation proof. This candidate makes no measured smoothness or memory claim.

## Next implementation step

Memoize the existing query projections, replace only the Popular scroll body with the native two-column list, then adapt the journey harness and verify the scrolling path on Android.
