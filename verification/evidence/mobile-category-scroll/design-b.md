# Candidate B: explicit category rows on native `FlatList`

## Problem

`CategoriesView` puts every popular or followed card inside one `ScrollView`, so render and image-mount cost grows with every provider page. Pagination already belongs to `useCategoryCatalog`, while `composeCategoryCatalog` owns cross-provider merge and viewer-count ordering. The rendering change must keep that ownership, preserve the two-column design and all header/error states, and tolerate a merged category moving when a later Twitch or Kick page changes its combined viewer count.

## Usage (caller's view)

The screen continues to pass one catalog view and one load-more action. It does not coordinate rows or virtualization.

```tsx
const catalog = useCategoryCatalog({ preferences, query, session });

return (
  <CategoriesView
    canLoadMore={
      platform === "all"
        ? catalog.canLoadMore.twitch || catalog.canLoadMore.kick
        : catalog.canLoadMore[platform]
    }
    loadingMore={
      platform === "all"
        ? catalog.loadingMore.twitch || catalog.loadingMore.kick
        : catalog.loadingMore[platform]
    }
    onLoadMore={() => catalog.loadMore(platform)}
    onRefresh={catalog.refresh}
    platform={platform}
    tab={tab}
    view={catalog.view}
    {...navigationAndFilterProps}
  />
);
```

Popular and followed branches each hand an already ordered card projection to the same grid list. The list alone owns pairing and virtualization.

```tsx
const cards = useMemo(
  () => projectPopularCategoryCards(view, platform),
  [platform, view.categories, view.providers.kick.items, view.providers.twitch.items],
);

return <CategoryGridList cards={cards} header={header} pagination={pagination} />;
```

```tsx
const cards = useMemo(
  () => projectFollowedCategoryCards(follow.view.categories, catalog),
  [catalog, follow.view.categories],
);

return <CategoryGridList cards={cards} header={header} />;
```

## Shape

### Module map

```text
src/features/discovery/components/
  categories-screen.tsx          tab orchestration and existing controls/states
  category-grid-list.tsx         one virtualized, refreshable two-column list
  category-grid-projection.ts    pure card identities, provider projection, pairing
  category-card.tsx              unchanged popular card appearance

src/features/discovery/components/use-category-catalog.ts
                                 provider paging and in-flight load guard

src/features/discovery/tests/
  category-grid-projection.test.ts
  categories-screen.test.tsx
```

The projection is presentation code because row pairing and render keys exist only for the two-column list. Provider merging and sorting stay in `domain/category-catalog.ts`; remote state stays in TanStack Query.

### Data structures first

```ts
type CategoryCardKey = string & { readonly __categoryCardKey: unique symbol };
type CategoryRowKey = string & { readonly __categoryRowKey: unique symbol };

type PopularCategoryCell = {
  readonly key: CategoryCardKey;
  readonly kind: "popular";
  readonly category: CatalogCategory;
};

type FollowedCategoryCell = {
  readonly key: CategoryCardKey;
  readonly kind: "followed";
  readonly category: Category;
};

type CategoryGridCell = PopularCategoryCell | FollowedCategoryCell;

type CategoryGridRow = {
  readonly key: CategoryRowKey;
  readonly cells:
    | readonly [CategoryGridCell]
    | readonly [CategoryGridCell, CategoryGridCell];
};

function projectPopularCategoryCards(
  view: CategoryCatalogView,
  platform: "all" | Platform,
): readonly PopularCategoryCell[] {
  throw new Error("not implemented");
}

function projectFollowedCategoryCards(
  items: TabItems<Category>,
  catalog: readonly CatalogCategory[],
): readonly FollowedCategoryCell[] {
  throw new Error("not implemented");
}

function pairCategoryCards(
  cards: readonly CategoryGridCell[],
): readonly CategoryGridRow[] {
  throw new Error("not implemented");
}
```

For the `all` scope, a popular card key is the merge identity already used by `mergeCategories`: `popular:all:${normalizeCategoryName(name)}`. It survives a Kick-only result becoming a Twitch-preferred merged result. A provider-scoped popular key is `popular:${platform}:${id}`. A followed key is `followed:${platform}:${id}` because followed categories are provider-local and are not merged.

Rows retain input order and use `row:${left.key}|${right?.key ?? "empty"}`. The keys never use array indexes. Appending a page leaves existing full-row keys unchanged. A real viewer-count reorder can change pair membership and therefore row keys; card keys remain semantic, and no stale row is mistaken for different content.

Provider projection should build `Map<platform:id, Category>` indexes once per memoized projection. That replaces `visibleCategories` and the followed tab's per-card `catalog.find`, both of which repeatedly scan provider arrays. The pure projector returns the exact card model the renderer needs and hides fallback-art and provider-identity rules behind one call, per boundary discipline.

### Virtualized list

```tsx
type CategoryGridListProps = {
  readonly cards: readonly CategoryGridCell[];
  readonly empty?: ReactNode;
  readonly footer?: ReactNode;
  readonly header: ReactNode;
  readonly onEndReached?: () => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly refreshing: boolean;
};

function CategoryGridList(props: CategoryGridListProps) {
  const rows = useMemo(() => pairCategoryCards(props.cards), [props.cards]);
  // Return MobileRefreshableFlatList<CategoryGridRow> with:
  // keyExtractor={(row) => row.key}
  // renderItem={memoized row renderer; child key is cell.key}
  // initialNumToRender={4}, maxToRenderPerBatch={4}, windowSize={5}
  // onEndReachedThreshold={0.5}
  // ListHeaderComponent, ListEmptyComponent, ListFooterComponent
  throw new Error("not implemented");
}
```

`CategoriesView` chooses exactly one branch, so there is never a virtualized list nested inside a same-direction `ScrollView`:

```tsx
return tab === "popular" ? (
  <PopularCategoryList {...popularProps} />
) : followingSession ? (
  <FollowedCategoryList {...followedProps} />
) : null;
```

`PopularCategoryList` calls `onLoadMore` from `onEndReached` only when `canLoadMore && !loadingMore`. The query hook guards each provider with `hasNextPage && !isFetchingNextPage` and coalesces calls behind one in-flight promise per provider, so duplicate end events are idempotent at the owner of pagination. Keep the visible "Load more categories" button in the footer as an accessible fallback; it invokes the same guarded action. Followed has no pagination callback and cannot trigger popular paging. Pull-to-refresh uses discovery refresh on Popular and `follow.refresh` on Followed.

Search, tabs, provider chips, language selector, proof controls, provider banners, phase copy, retry, and loading states move into the appropriate `ListHeaderComponent`. The spinner and manual load action move to the footer. `styles.content` keeps the current medium padding and extra bottom padding. A row uses `flexDirection: "row"` and `columnGap: "4%"`; both existing card components retain `width: "48%"`. `ItemSeparatorComponent` supplies the current medium vertical gap. No card typography, art ratio, radii, colors, or test IDs change.

Memoize `composeCategoryCatalog` inside `useCategoryCatalog` from query data references, language, loading, and query. Memoize popular and followed display projections from their collection references and active platform. This prevents an unrelated fetching-state render from rebuilding maps, rows, and callbacks, while preserving a new projection whenever search results, pages, provider scope, followed live data, or viewer counts change. Memoization is an optimization around pure projections, never a second source of catalog state.

The public surface stays small: callers provide cards, slots, refresh, and an optional end action. The list hides pairing, keys, rendering dispatch, window settings, gaps, and empty-row behavior. It does not expose provider cursors or TanStack Query objects.

## Synthesis decision

Candidate B recommends native `FlatList` over a recycler dependency, using explicit paired rows as the virtualized unit. It gives both card variants one list contract, makes two-column layout and row keys explicit, and avoids adding a package for a catalog expected to be in the low hundreds. The arena synthesizer should prefer the `numColumns` candidate if it values per-card movement identity over explicit row control; both eliminate the unbounded `ScrollView` mount.

## Tradeoffs accepted

- We accept a small pairing projection and possible remount of cards whose row membership changes in exchange for explicit, deterministic row virtualization and identical layout across popular and followed card variants.
- We accept conservative fixed window settings in exchange for bounded mounted work; these values are configuration defaults, not performance claims, and should change only with observed device evidence.
- We accept retaining the manual load button in exchange for keyboard/accessibility fallback and deterministic tests alongside automatic loading.
- We accept swapping list instances when tabs change in exchange for keeping the followed query hook and tab-specific refresh behavior isolated; preserving a separate scroll offset per tab can be added with refs if product behavior requires it.

## Alternatives considered

- Native `FlatList` with `numColumns={2}` is less projection code and preserves per-card keys directly across reorders. It loses because column grouping and incomplete-row layout remain framework behavior, while this candidate needs one explicit render unit shared by two card types. It is the strongest alternative and may be the better synthesis choice if minimal code is weighted above row control.
- Shopify FlashList or another recycler could provide stronger reuse for very large, image-heavy catalogs. It loses because no recycler is currently installed, React Native already supplies virtualization, and the stated 100-plus-card case does not justify new runtime and Expo compatibility surface without measurements.
- Incrementally truncating a `ScrollView` hides older cards or grows mounted work after each reveal. It loses because the caller must coordinate a render limit and it never provides true windowing.

## Tests

- Projection unit tests: 101 cards become 51 ordered rows; the final row has one cell; all row and card keys are unique and contain no indexes.
- Merge stability test: a Kick-only `all` card keeps its logical card key when a Twitch counterpart arrives and becomes the display winner; changed aggregate viewers can reorder it without duplication or loss.
- Scope tests: Twitch/Kick selection uses that provider's ID and art while preserving `otherId`; followed keys remain provider-local; fallback art is resolved through the prebuilt catalog index.
- List contract test with a capturing `FlatList` mock: 101 cards pass 51 rows plus the bounded initial/batch/window props, rather than 101 eagerly created card elements.
- Pagination tests: crossing the end threshold invokes the guarded action once while eligible; fetching, exhausted, and Followed states do not invoke it; the footer button calls the same action.
- UI journey tests: Popular and Followed retain search, tabs, chips, language-only-on-Popular, banners, phase/retry copy, pull-to-refresh owner, card test IDs, and category navigation identity.

## Open questions and risks

- Should switching tabs restore each tab's previous scroll offset, or intentionally start the newly selected tab at the top?
- Does the product require three or more columns on tablets? If so, fixed pairs encode a phone-only layout and `numColumns` or width-derived rows become preferable.
- Will remote search replace local paged results or merge with them indefinitely? The existing composer merges them, so stable logical keys are essential when a remote result changes the preferred provider representation.

## Next implementation step

Build and unit-test the pure card projection and pairing functions first, including the merged-winner key case, before replacing `MobileRefreshableScroll`.
