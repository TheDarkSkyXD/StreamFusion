---
title: Twitch GQL search dropdown skeleton-flicker loop
date: 2026-05-17
category: integration-issues
module: apps/desktop/backend/twitch-gql
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "Twitch global-search dropdown shows infinite skeleton-loading flicker when scrolled to bottom"
  - "Terminal logs repeat cursor MTA= 17+ times in a row from one search session"
  - "react-query fetchNextPage keeps firing because each response returns identical page-1 data with a fresh-looking cursor"
  - "SearchResultsPage_SearchResults persisted op ignores after/first variables silently — no GQL error"
  - "Duplicate channel and game IDs returned across pages, defeating naive empty-page guards"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - service_object
  - testing_framework
tags:
  - twitch
  - graphql
  - pagination
  - persisted-queries
  - electron
  - react-query
  - infinite-loop
  - integration-issue
---

# Twitch GQL search dropdown skeleton-flicker loop

## Problem

The global-search dropdown in StreamFusion entered an infinite skeleton-flicker loop when scrolled to the bottom: the same 10 channels with the same cursor `MTA=` were re-fetched in a tight loop (17+ identical backend calls observed per session), and the user could not scroll away to escape it.

## Symptoms

- Bottom load-more skeletons appeared, briefly resolved, then reappeared every few hundred milliseconds — a visible flicker loop.
- Terminal showed `[SearchHandler] Returning 10 channels (cursor: MTA=)` repeated 17+ times with identical payload and identical cursor.
- Scrolling could not break the loop; the dropdown was effectively stuck at the bottom.
- React Query's `hasNextPage` stayed permanently `true` because the server kept returning a truthy `cursor`.
- No GQL errors surfaced — the upstream silently dropped the pagination input.

## What Didn't Work

1. **Empty-page guard in React Query `getNextPageParam`.** First hypothesis: an empty page with a truthy cursor was keeping `hasNextPage` true. Added `lastPage.data.length === 0 ? undefined : cursor` in `apps/desktop/src/hooks/queries/useSearch.ts`. Tests passed; live loop continued because every page had 10 channels — they were just duplicates of page 1.

2. **Cursor-no-advance guard at the GQL client only.** Added `returnedCursor !== options.after` so a server that echoed the input cursor would terminate. Stopped the loop on page 3, but exposed that page 2 returned a *different* cursor (`MTU=`) with a *different* 15-channel payload — meaning the persisted query and the raw query disagreed on the first page size, and real pagination still wasn't happening.

3. **Forwarding `first` / `after` as unlisted variables on the persisted query.** Tried passing them to `getQuerySearchResultsPageSearchResults` from the `twitch-gql-queries` package via `Record<string, unknown>` + double-cast, since the typed `SearchResultsPageSearchResultsVariables` interface omits them. Persisted queries are resolved server-side by SHA hash, so unlisted variables are dropped silently. No effect.

4. **Raw-GQL query with `cursor` / `first` on the `channels` / `games` connections.** Twitch rejected the document with schema errors:
   - `Field "searchFor" argument "platform" of type "String!" is required but not provided`
   - `Unknown argument "cursor" on field "channels" of type "SearchFor"`
   - `Unknown argument "first" on field "channels" of type "SearchFor"`
   - `Cannot query field "id" on type "SearchForItem"` (also `login`, `displayName`, etc. — `item` is a union and requires inline fragments).

5. **Fixed raw-GQL query with `... on User` fragment and required `platform: "web"`.** Server accepted it and returned 15 channels with a cursor, but every subsequent call returned the *same* 15 channels with the *same* cursor — the `channels` connection simply does not honor cursor input for anonymous queries via this operation. Twitch's own web client paginates through a separate persisted op `SearchResultsPage_LoadMoreChannelResults` whose SHA hash isn't shipped in the `twitch-gql-queries` package.

## Solution

Treat the cursor as advisory and stop the loop in three layers, with deterministic precedence.

**Page 1: keep the existing persisted query** (top 10 channels, known-good). **Page 2+: use the fixed raw-GQL query** with `... on User` fragment and `platform: "web"`; accept that cursor input isn't honored — the raw query still returns ~50% more unique results than page 1, and the guards below cleanly terminate after that.

**Shared loop-stop seam** in `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts`, precedence **integrity > empty > exhausted > no-advance**:

```typescript
function buildPaginatedResult<T>(
  context: string,
  data: T[],
  returnedCursor: string | undefined,
  inputCursor: string | undefined,
  isIntegrityRejected: boolean
): PaginatedResult<T> {
  if (isIntegrityRejected) {
    console.debug(`[GQL] ${context} end-of-list: integrity-rejected`);
    return { data, cursor: undefined, endReason: "integrity-rejected" };
  }
  if (data.length === 0) {
    console.debug(`[GQL] ${context} end-of-list: empty-page`);
    return { data, cursor: undefined, endReason: "empty-page" };
  }
  if (!returnedCursor) {
    console.debug(`[GQL] ${context} end-of-list: exhausted (server returned no cursor)`);
    return { data, cursor: undefined, endReason: "exhausted" };
  }
  if (returnedCursor === inputCursor) {
    console.debug(
      `[GQL] ${context} end-of-list: cursor-no-advance (server echoed input cursor ${returnedCursor})`
    );
    return { data, cursor: undefined, endReason: "cursor-no-advance" };
  }
  return { data, cursor: returnedCursor };
}
```

**UI-layer dedup-absorption detector** in `apps/desktop/src/components/search/UnifiedSearchInput.tsx` — a cross-render `useRef` keyed by `${platform}-${id}`. When a fetched page contributes zero net new uniques, set an `absorbed` flag and stop fetching. Uses `useLayoutEffect` so it lands before any queued scroll handler can re-trigger the loader.

**`AbortSignal.timeout(10s)`** on every GQL POST in `gqlRequest` and `sendPersistedQuery` so a hung endpoint cannot freeze pagination.

**Case-insensitive integrity matcher with per-error classification**:

```typescript
function isIntegrityRejectionError(err: GqlError): boolean {
  const code = err.extensions?.code ?? "";
  if (code.toUpperCase().includes("INTEGRITY")) return true;
  const msg = err.message.toLowerCase();
  if (!msg.includes("integrity")) return false;
  return msg.includes("check") || msg.includes("failed") || msg.includes("rejected");
}
```

Requires co-occurrence of `integrity` with `check` / `failed` / `rejected` to avoid false positives from schema errors that merely mention a `clientIntegrity` field. Classification is per-error so non-integrity errors in the same envelope still emit `console.warn`.

**Scroll-handler latch with sync-throw protection**:

```typescript
const latch = fetchInFlightRef.current;
if (... && !latch.channels) {
  latch.channels = true;
  try {
    Promise.resolve(fetchMoreChannels()).finally(() => {
      latch.channels = false;
    });
  } catch {
    latch.channels = false;
  }
}
```

`Promise.resolve` normalizes async vs sync return; `try/catch` ensures the latch is released even on synchronous throw.

## Why This Works

The root cause is a **schema-level constraint we cannot fix from the client**: Twitch's `searchFor.channels` connection on the publicly callable operation does not honor `cursor` / `first` for anonymous traffic, and the persisted op that *does* paginate (`SearchResultsPage_LoadMoreChannelResults`) is not in `twitch-gql-queries`. No amount of client-side variable wrangling can make that connection paginate.

Given an upstream that *will* hand back an echoed cursor and identical payload, the only safe contract is to stop trusting the cursor as ground truth. The three guards encode that contract with deterministic precedence:

- **integrity-rejected** drains the loop when the server is gating us with bot checks (highest precedence — we shouldn't keep hammering an actively-rejecting endpoint).
- **empty-page** handles the textbook "truthy cursor over empty data" case.
- **exhausted** is the well-behaved-server path (no cursor returned).
- **cursor-no-advance** catches the misbehaving Twitch path that returns the same cursor as input.

The UI dedup-absorption detector is the safety net for the case where the server returns a *different* cursor but content the user has already seen — guard precedence at the network layer can't see that, but the UI can.

## Prevention

Reusable pattern for any flaky-upstream paginated API:

1. **Always centralize pagination termination in one seam** (`buildPaginatedResult` in this codebase). Never decide "should we fetch the next page?" in two places.
2. **Encode precedence explicitly** — `integrity > empty > exhausted > no-advance`. Each branch returns a discriminated `endReason` so logs and tests can assert *why* a fetch stopped.
3. **Add a UI-layer dedup-absorption fallback** for APIs that may return novel cursors with stale content. `useLayoutEffect` + a cross-render `useRef` set keyed by stable `${platform}-${id}`. Reset on query change AND on any in-flight latch.
4. **Bound every upstream call with `AbortSignal.timeout`** so a hung response can't freeze the loop. 10 seconds is the calibration for Twitch GQL's p99 latency.
5. **Classify errors per-element, case-insensitive, with co-occurrence requirements** to avoid false positives from neighboring schema field names (don't match on the bare word `integrity`).
6. **Wrap async dispatch in `try/catch` + `Promise.resolve(...).finally(...)`** for scroll-handler latches so a synchronous throw releases the latch instead of leaking it.

Regression tests that lock the contract in place — already shipped:

- `apps/desktop/tests/backend/twitch-gql-search.test.ts` (26 tests): cursor-no-advance, integrity-rejected, empty-page, exhausted, mixed-error envelope, false-positive negative case (schema error mentioning `clientIntegrity` doesn't trip the guard), path-discrimination across persisted vs raw query paths.
- `apps/desktop/tests/components/search/UnifiedSearchInput.test.tsx` (10 tests): 100-result cap, "Show more" CTA copy toggle, scroll-suppression at cap, dedup-absorption stop after duplicate page arrives.

Live electron-mcp verification: 3-call termination (page 1, page 2 advances, page 3 no-advance) replacing the original 17 redundant calls. Any future regression that re-introduces loop behavior should fail one of the 26 backend tests by missing the expected `endReason`, or fail the absorption test by exceeding the expected fetch count.

## Related Issues

- Origin documents: `docs/brainstorms/2026-05-17-search-pagination-requirements.md`, `docs/plans/2026-05-17-001-feat-search-pagination-plan.md`
- Commits (chronological): `889c426` feat, `f0ce82a` P1 fixes, `ec6c5b8` P2 fixes, `2f7c589` P3 fixes, `dcc1347` second-round P1/P2 fixes
- Related upstream-API reference: `docs/api/twitch/gql-api.md`
- This doc promotes a prior user-level memory entry (`project_twitch_search_pagination_limit.md`) into the repo's institutional knowledge base per the `ce-learnings-researcher` recommendation in the second code-review pass.
