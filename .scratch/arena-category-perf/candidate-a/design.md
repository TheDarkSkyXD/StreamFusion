# Candidate A: provisional publication inside the combined query

## Usage, caller's view

The public hook stays unchanged. `CategoriesPage` renders the first useful Platform as soon as it arrives. It does not need to understand provisional pages, per-Platform cursors, or provider failures.

```tsx
const {
  data: categories,
  isLoading,
  isError,
  refetch,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteTopCategories();

return (
  <VirtualizedCategoryGrid
    categories={categories}
    isLoading={isLoading}
    hasNextPage={hasNextPage}
    isFetchingNextPage={isFetchingNextPage}
    onLoadMore={() => void fetchNextPage()}
  />
);
```

On a cold start where Twitch returns first, the same call publishes Twitch cards before Kick settles.

```tsx
const query = useInfiniteTopCategories();

// Observable sequence:
// 1. data is [] and isLoading is true.
// 2. Twitch returns. data contains Twitch cards and isLoading is false.
// 3. Kick settles. Matching cards merge and viewer counts are summed.
```

`CategoryDetailPage` keeps using the merged catalog without learning which provider arrived first.

```tsx
const { data: mergedCategoryCatalog } = useInfiniteTopCategories();
const currentCategory = mergedCategoryCatalog.find(
  (category) => category.id === categoryId || category.crossPlatformId === categoryId
);
```

No caller changes are required. The hook still returns the flattened `UnifiedCategory[]` expected by the existing Categories and Category Detail pages.

## Problem

`useInfiniteTopCategories` currently starts Twitch and Kick together but awaits their `Promise.all` before returning a page. The measured cold path produced 100 Twitch categories in 144 ms while Kick was still unresolved at 12,001 ms. The UI therefore shows skeletons even though one complete, useful Platform page is ready. The fix must keep one merged catalog, independent Twitch and Kick cursors, normalized-name deduplication, summed viewer counts, partial-provider success, and the existing non-overlapping load-more behavior.

## Shape

### Core data shape

The infinite cache owns one of two page states. A provisional page can render categories but cannot paginate. A settled page owns both provider cursors and can produce the next page parameter.

```ts
interface CategoryProviderCursors {
  twitch: string | null;
  kick: string | null;
}

interface CategoryScrollPageParam {
  cursors: CategoryProviderCursors;
  knownCategoryKeys: string[];
}

type CategoryProviderPageOutcome =
  | {
      kind: "success";
      platform: Platform;
      categories: UnifiedCategory[];
      nextCursor: string | null;
    }
  | {
      kind: "failure";
      platform: Platform;
      error: unknown;
    };

type CategoryScrollPage =
  | {
      kind: "provisional";
      categories: UnifiedCategory[];
    }
  | {
      kind: "settled";
      categories: UnifiedCategory[];
      cursors: CategoryProviderCursors;
    };
```

The discriminant makes an unresolved cursor impossible to consume. `getNextPageParam` returns `undefined` for a provisional page. This prevents the virtualized grid from starting load more while the initial provider round is still settling, per `principle-type-system-discipline` and `principle-model-the-domain`.

Twitch and Kick remain independent cursor owners inside `CategoryProviderCursors`. The hook merges their published facts only for reads, per `principle-separate-before-serializing-shared-state` and `principle-foundational-thinking`.

### Signatures

```ts
function requestCategoryProviderPage(input: {
  platform: Platform;
  cursor: string | null;
}): Promise<CategoryProviderPageOutcome>;

function publishFirstUsefulInitialPage(input: {
  queryClient: QueryClient;
  queryKey: readonly unknown[];
  pageParam: CategoryScrollPageParam;
  outcome: CategoryProviderPageOutcome;
  signal: AbortSignal;
}): void;

async function loadCategoryScrollPage(input: {
  pageParam: CategoryScrollPageParam;
  queryClient: QueryClient;
  queryKey: readonly unknown[];
  signal: AbortSignal;
}): Promise<CategoryScrollPage>;

function getNextCategoryPageParam(
  lastPage: CategoryScrollPage,
  allPages: CategoryScrollPage[]
): CategoryScrollPageParam | undefined;

export function useInfiniteTopCategories(): {
  data: UnifiedCategory[];
  isLoading: boolean;
  isError: boolean;
  refetch: UseInfiniteQueryResult<CategoryScrollPage>["refetch"];
  fetchNextPage: UseInfiniteQueryResult<CategoryScrollPage>["fetchNextPage"];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  // The implementation retains the remaining TanStack result fields.
};
```

`requestCategoryProviderPage` converts both a rejected IPC promise and a `{ success: false }` response into the failure variant. It converts a successful IPC response into application-owned categories and a normalized `string | null` cursor. Provider transport details stop at this private boundary, per `principle-boundary-discipline`.

`loadCategoryScrollPage` starts every active Platform request at once. On the cold initial page only, each normalized promise gets a publication continuation before the function awaits the complete round. The first successful non-empty outcome atomically seeds the existing infinite query cache with this value.

```ts
{
  pages: [{ kind: "provisional", categories: outcome.categories }],
  pageParams: [FIRST_CATEGORY_SCROLL_PAGE],
}
```

Publication is skipped when the signal is aborted, when the page is not the initial page, or when the query cache already contains a page. The update is idempotent. A second provider cannot append a second provisional page, per `principle-make-operations-idempotent`.

After the round settles, the existing fill loop continues unchanged in intent. It applies each outcome to only that Platform's cursor, accumulates raw categories, and stops after it adds 100 distinct normalized names or no provider can advance. The query function then returns one settled page. TanStack replaces the provisional cache value with this authoritative result.

`mergeCategories` remains the single read transform. It deduplicates normalized names, preserves the existing Twitch winner and `slots` exception, writes the other Platform id into `crossPlatformId`, and sums both viewer counts. The returned hook data always runs every cached page through this transform. A provisional Twitch card can therefore gain Kick metadata and viewer count without the caller changing shape.

`getNextCategoryPageParam` only accepts a settled last page. It derives `knownCategoryKeys` from every page's categories and carries forward the two independent cursors. A failed or exhausted Platform has `null`; the other Platform continues alone.

The existing `loadMoreInFlight` ref remains the only load-more lock. Repeated calls return the same promise, and `cancelRefetch: false` prevents TanStack from replacing the active request. A provisional page exposes no next page, so cold-start settlement and load more cannot overlap through the UI.

This is a deep interface. One unchanged hook hides provider concurrency, provisional publication, cursor ownership, fill rounds, error reduction, deduplication, viewer aggregation, and overlap control. No new public option or orchestration method leaks to pages, per `principle-minimize-reader-load` and `principle-laziness-protocol`.

### Module map

```text
apps/desktop/src/frontend/pages/Categories/index.tsx
  unchanged caller of useInfiniteTopCategories

apps/desktop/src/frontend/pages/CategoryDetail/index.tsx
  unchanged catalog consumer

apps/desktop/src/frontend/features/discovery/data/queries/useCategories.ts
  owns provider round outcomes
  owns provisional and settled page types
  owns early query-cache publication
  owns cursor advancement, fill policy, merge policy, and load-more deduplication

apps/desktop/tests/hooks/queries/useCategories.test.tsx
  observes provider timing, merge completion, cursor independence, failures, and request overlap

apps/desktop/tests/pages/Categories.test.tsx
  unchanged public hook contract and loading behavior
```

No backend, preload, IPC contract, shared type, Zustand store, or page change earns its place. The latency comes from renderer orchestration after two valid provider requests have already started. Fixing it at the query owner addresses the root cause, per `principle-fix-root-causes` and `principle-redesign-from-first-principles`.

### Exact test seams

Add these hook tests beside the existing `useInfiniteTopCategories` cases.

1. `publishes Twitch before a pending Kick request settles`. Return Twitch's first 100 immediately and hold Kick with `deferred`. Assert `data` contains Twitch categories while Kick is unresolved, `isLoading` is false, `hasNextPage` is false, and each Platform has exactly one IPC call.
2. `reconciles the provisional page when Kick settles`. Use the same normalized category name on both Platforms with distinct viewer counts. Resolve Kick after the early Twitch assertion. Assert one merged card, the existing winner and cross-Platform id rules, the summed viewer count, and the settled cursor-derived `hasNextPage` value.
3. `publishes Kick first when Twitch is pending`. Reverse the deferred provider. This catches accidental Twitch priority in publication while retaining Twitch priority only in the final merge.
4. `does not publish after initial query cancellation`. Unmount, observe the query signal cancellation, then resolve a provider. Assert the infinite cache stays empty.
5. Extend `fills one load-more action to 100 new merged categories` with asymmetric cursors. Exhaust Kick on page one, keep Twitch cursored, and assert later rounds call Twitch only.
6. Strengthen `does not overlap load-more requests`. Capture both returned promises and assert identity as well as the existing IPC call count.

Keep the current provider-rejection tests. One provider failure plus one success must remain query success. Both provider failures with no category data must remain query error. Keep the `useCategoryById` infinite-cache reuse test. Its page fixture should add `kind: "settled"` to document the new invariant.

The runtime proof should repeat the cold Categories navigation with degraded Kick. The acceptance point is rendered Twitch category cards near the measured Twitch completion, not after Kick's 12-second timeout. Then let Kick settle and verify the grid contains no duplicate normalized names and matching viewer counts increase rather than replace one another, per `principle-prove-it-works` and `principle-experience-first`.

## Synthesis decision

Candidate A selects minimal early publication inside the existing combined infinite query. It keeps TanStack Query as the sole server-state owner and leaves callers unchanged. The parent arena can compare this against split per-Platform queries. If this candidate becomes the base, retain its provisional page discriminant and first-write-only cache update. Those two pieces prevent cursor misuse and duplicate provisional pages.

The candidate rejects a second React state channel for early categories. A local `useState` mirror can be owned by an unmounted StrictMode observer while TanStack reuses its request, leaving the remounted observer stuck behind Kick. It also forces reconciliation between two state owners.

## Tradeoffs accepted

- We accept one deliberate `queryClient.setQueryData` call from the initial query function in exchange for publishing the first useful provider through the same cache every observer already reads.
- We accept a short-lived provisional cache variant in exchange for making premature pagination impossible in the type shape.
- We accept that load more still settles one provider round before completing its 100-new-category fill in exchange for keeping the fix scoped to measured cold-start latency.
- We accept one visible reorder when the second Platform adds viewer counts in exchange for showing useful cards roughly 12 seconds earlier in the measured degraded-Kick case.

## Alternatives considered

### Two independent infinite queries

One query per Platform would publish independently by default and give TanStack direct ownership of each cursor. It lost because the combined hook would need a custom multi-query status reducer, refetch contract, load-more fill coordinator, and fresh-cache reads between rounds. That is a larger internal interface and moves more existing tests at once. It remains the fallback if TanStack cannot reliably replace a provisional page after same-key cache publication.

### Return after the first provider and refresh the second separately

Resolving the query on the first provider would make the first paint fast. It loses the still-running provider request and requires another query, effect, or cache mutation path to publish final merged data. The caller or hook would then coordinate two lifecycles without gaining better cursor ownership.

### Race with a fixed timeout

Waiting a small grace period for Kick before returning would cap the stall but still delays Twitch, makes behavior timing-dependent, and cannot reconcile a late Kick result without another state channel. It hides little complexity and introduces a product-visible tuning constant.

## Open questions and risks

- Does TanStack Query 5.101.4 always replace the provisional same-key `InfiniteData` with the query function's settled page rather than append it? The first two hook tests must prove this exact library behavior before implementation proceeds.
- Should the page show a subtle provider-refresh indicator while a provisional page is visible? Candidate A recommends no UI change because the current partial-provider contract is intentionally silent and the Platform health banner already reports degradation.
- Can an IPC provider promise remain unresolved forever after query cancellation? The publication guard prevents stale cache writes, but the existing IPC transport still cannot abort the main-process request.

## Red-flag screen

- Shallow module. Pass. The unchanged hook hides the complete orchestration policy.
- Information leakage. Pass. Pages receive only `UnifiedCategory[]` and TanStack status fields. Provisional state and provider outcomes stay private.
- Temporal decomposition. Pass. Provider outcomes, cursor rules, publication, and merge policy remain together in the category query owner instead of new stage-named modules.
- Pass-through method. Pass. Each proposed helper normalizes a boundary or protects a cache invariant. No helper forwards the same arguments unchanged.

## Next implementation step

Write the deferred-Kick cold-start hook test, then add the provisional page union and first-write-only publication inside `useCategories.ts` until that test passes without changing either page caller.
