# Candidate B design: provider-owned category infinite queries

## Problem

`useInfiniteTopCategories` currently owns Twitch and Kick pagination in one infinite query. Each cursor round calls both active providers inside `Promise.all`, so a useful Twitch page cannot publish until a slow or degraded Kick request settles. The measured baseline makes the bug concrete: Twitch returned 100 categories in 144 ms while Kick stayed unresolved at 12,001 ms. The replacement must publish the first useful provider page as soon as that provider resolves, keep Twitch and Kick cursors independent, keep the current merge policy, preserve partial-provider error behavior, and avoid duplicate load-more calls.

## Usage (caller's view)

The Categories page keeps the same import and the same render logic.

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
```

Cold start behavior changes at the hook boundary. If Twitch page one resolves before Kick, `data` contains the merged Twitch rows, `isLoading` is `false`, and `isFetching` remains `true` while Kick continues. The page can render the grid immediately.

```tsx
<VirtualizedCategoryGrid
  categories={filteredCategories}
  isLoading={isLoading || !canRenderGrid}
  isFetchingNextPage={isFetchingNextPage}
  hasNextPage={hasNextPage}
  onLoadMore={() => void fetchNextPage()}
  skeletonCount={12}
  scrollKey="categories-page"
  datasetKey={searchQuery.trim().toLowerCase() || "all"}
  emptyMessage={searchQuery ? `No categories matching "${searchQuery}"` : "No categories found"}
/>
```

`useCategoryById` should read the same provider page caches before it falls back to `categories.getById`.

```ts
const infiniteReference = getCachedCategoryReference(queryClient, categoryId, platform);
```

Tests keep using the public hook. They should not call any new helper.

```ts
const { result } = renderHook(() => useInfiniteTopCategories(), { wrapper: makeWrapper() });
```

## Type sketch

```ts
type CategoryProvider = Extract<Platform, "twitch" | "kick">;

interface ProviderCategoryPageParam {
  cursor: string | undefined;
}

interface ProviderCategoryPage {
  platform: CategoryProvider;
  categories: UnifiedCategory[];
  nextCursor: string | null;
}

type ProviderLaneStatus =
  | { kind: "loading"; platform: CategoryProvider }
  | { kind: "ready"; platform: CategoryProvider; pageCount: number; hasNextPage: boolean }
  | { kind: "failed"; platform: CategoryProvider; error: Error };

interface MergedCategorySnapshot {
  categories: UnifiedCategory[];
  lanes: Record<CategoryProvider, ProviderLaneStatus>;
  hasAnyData: boolean;
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  allProvidersFailed: boolean;
}

interface MergedFetchNextPageOptions {
  cancelRefetch?: boolean;
}

interface ProviderCategoryQuery {
  platform: CategoryProvider;
  data: InfiniteData<ProviderCategoryPage> | undefined;
  error: Error | null;
  fetchNextPage: UseInfiniteQueryResult<ProviderCategoryPage>["fetchNextPage"];
  hasNextPage: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  refetch: UseInfiniteQueryResult<ProviderCategoryPage>["refetch"];
}
```

## Signatures

```ts
const CATEGORY_PROVIDERS = ["twitch", "kick"] as const satisfies readonly CategoryProvider[];

export const CATEGORY_KEYS = {
  all: ["categories"] as const,
  top: (platform?: Platform) => [...CATEGORY_KEYS.all, "top", platform] as const,
  topInfiniteProvider: (platform: CategoryProvider) =>
    [...CATEGORY_KEYS.all, "top", "infinite", platform] as const,
  byId: (categoryId: string, platform: Platform) =>
    [...CATEGORY_KEYS.all, "id", platform, categoryId] as const,
  metadata: (categoryId: string, platform: Platform) =>
    [...CATEGORY_KEYS.all, "metadata", platform, categoryId] as const,
};

function useProviderTopCategoryPages(platform: CategoryProvider): ProviderCategoryQuery;

async function fetchProviderCategoryPage(args: {
  platform: CategoryProvider;
  cursor: string | undefined;
  signal: AbortSignal;
}): Promise<ProviderCategoryPage>;

function nextProviderCategoryPageParam(
  lastPage: ProviderCategoryPage
): ProviderCategoryPageParam | undefined;

function readMergedCategorySnapshot(
  lanes: readonly ProviderCategoryQuery[]
): MergedCategorySnapshot;

function readCachedProviderCategories(
  queryClient: QueryClient,
  platform?: CategoryProvider
): UnifiedCategory[];

function createMergedFetchNextPage(args: {
  queryClient: QueryClient;
  lanes: readonly ProviderCategoryQuery[];
  targetNewCount: number;
}): (options?: MergedFetchNextPageOptions) => Promise<unknown>;

export function useInfiniteTopCategories(): {
  data: UnifiedCategory[];
  error: Error | null;
  fetchNextPage: (options?: MergedFetchNextPageOptions) => Promise<unknown>;
  fetchStatus: "fetching" | "idle" | "paused";
  hasNextPage: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => Promise<unknown>;
};
```

## Module map

Keep this in `apps/desktop/src/frontend/features/discovery/data/queries/useCategories.ts` for the first implementation. The behavior is local to the category query hook, and a new module would add reader work before the shape proves it needs extraction.

`useProviderTopCategoryPages` owns one provider's React Query infinite state, IPC call, cursor advancement, and provider error logging. It never knows about cross-provider merge rules.

`readMergedCategorySnapshot` owns the read boundary. It flattens provider pages, calls `mergeCategories`, computes aggregate flags, and decides whether an all-provider failure should surface as the existing "Couldn't load categories from Twitch or Kick" error.

`createMergedFetchNextPage` owns the single in-flight load-more lease. It starts provider page requests only for lanes with `hasNextPage`, skips a lane that is already fetching, recomputes merged keys from the query cache after each settled provider page, and keeps fetching until the action adds 100 new merged category keys or every provider is exhausted.

`getCachedCategoryReference` should read `CATEGORY_KEYS.top(platform)`, `CATEGORY_KEYS.top(undefined)`, and the new `CATEGORY_KEYS.topInfiniteProvider(platform)` cache. It may also read the old aggregate infinite key during the migration so existing cache-seeded tests and persisted test fixtures still have a warm path.

## Shape

The core data shape is a provider lane. Twitch and Kick publish independent `ProviderCategoryPage` lists, each with its own cursor and terminal state. The aggregate hook derives every cross-provider fact from those lanes. This follows `principle-separate-before-serializing-shared-state`: the two providers publish independent facts, and the hook merges at the read boundary.

The only public interface stays `useInfiniteTopCategories`. Callers still receive a flat `UnifiedCategory[]`, aggregate loading flags, `hasNextPage`, `refetch`, and `fetchNextPage`. The interface hides two React Query infinite queries, partial error arbitration, dedupe policy, and load-more fill logic. That is the right interface depth. The page does not learn about provider cursors.

Boundary validation stays at the IPC response boundary. `fetchProviderCategoryPage` converts `DiscoveryResult<UnifiedCategory[]>` into either `ProviderCategoryPage` or a thrown `CategoryProviderError`. The merge and aggregation helpers only handle typed domain data. This follows `principle-boundary-discipline` and `typescript-best-practices`.

The aggregate status is derived, not stored. `isLoading` is true only while no provider has published data and at least one provider is loading. `isSuccess` is true once any provider has data or both providers complete with an empty result. `isError` is true only when every provider failed and no provider has data. Partial provider failures stay warnings and do not hide data from the other provider.

The load-more operation remains idempotent at the hook boundary. Repeated calls while one aggregate load-more action is active return the same promise. The coordinator reads current provider caches before each round, so a late Kick first page or a refetch cannot corrupt the known-key set. This follows `principle-make-operations-idempotent`.

## Synthesis decision

Candidate B recommends separate per-provider infinite queries with merge at the read boundary. This is the base design because it removes the cold-start wait without changing IPC, platform clients, page components, or the category merge rules. The rejected part of the current design is the single shared infinite query. That query makes cursor coordination simple, but it serializes user-visible progress on the slowest active provider.

## Tradeoffs accepted

- We accept two React Query cache entries in exchange for independent provider publication and cursor ownership.
- We accept a small aggregate status adapter in exchange for keeping `CategoriesPage` and `VirtualizedCategoryGrid` unchanged.
- We accept reading provider pages from the query cache during load-more in exchange for avoiding stale closure bugs when late provider pages settle.
- We accept a temporary legacy aggregate-cache read in `getCachedCategoryReference` in exchange for a lower-risk migration of existing tests and warm-reference behavior.

## Alternatives considered

- Keep one infinite query and replace `Promise.all` with `Promise.race`. This improves first publication, but the query still owns shared cursors and must mutate one page object as provider requests settle. It exposes temporal state inside one cache entry and keeps the hardest part of the current design.
- Keep one infinite query and add per-provider preview pages before the cursor loop. This fixes only cold page one. Load-more can still wait behind a slow provider, and the hook grows another special path.
- Move the fix to the backend by changing `categories:get-top` to stream provider pages. This hides frontend complexity, but it expands the IPC contract and forces preload and handler changes when the existing single-provider IPC already has the right cursor API.

## Open questions and risks

- Should `useInfiniteTopCategories` keep returning a promise from `fetchNextPage` that resolves only after the 100-new-category target is met, or is it enough that the grid receives provider pages as they arrive?
- Should a provider `success: false` result and a thrown IPC rejection use one `CategoryProviderError` path, or should logging keep the current distinction?
- How long should the legacy aggregate infinite cache read stay in `getCachedCategoryReference` after tests move to provider cache keys?

## Exact test seams

- Add a cold-start regression in `apps/desktop/tests/hooks/queries/useCategories.test.tsx`: Twitch resolves with 100 categories, Kick remains pending past the 12,001 ms baseline, and the hook reports `data.length === 100`, `isLoading === false`, and `isFetching === true` before Kick resolves.
- Keep the existing partial-provider rejection tests. They should still pass because aggregate `isError` requires both providers to fail with no data.
- Keep the all-provider rejection test. It should assert the returned aggregate error message, not a provider-specific error, because the page uses one retry UI.
- Keep the 100-new-category fill test. The coordinator must call Twitch page two and page three when page two contains duplicates and only adds 10 merged keys.
- Keep the no-overlap load-more test. The second `fetchNextPage` call should return the in-flight aggregate promise and must not start another provider page request.
- Update the `useCategoryById` warm infinite-cache test to seed `CATEGORY_KEYS.topInfiniteProvider("kick")` once the legacy aggregate read is removed. Until then, keep the legacy seed test as a migration guard.

## Red-flag screen

This design avoids a shallow module because the public hook stays small while hiding independent provider pagination, merge policy, and aggregate status derivation. It avoids information leakage because callers never receive provider cursor state. It avoids temporal decomposition because provider ownership and merge ownership are split by domain rule, not by "load then transform" phases. It avoids pass-through methods because the new helpers either own provider fetching, aggregate derivation, or load-more coordination.

## Next implementation step

Add `CATEGORY_KEYS.topInfiniteProvider`, `useProviderTopCategoryPages`, and the cold-start regression test before replacing the current single-query body of `useInfiniteTopCategories`.
