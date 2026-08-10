import { describe, expect, it } from "vitest";

import { APP_DATA_CACHE_POLICIES, getQueryCacheOptions } from "./cache-policy";

// Guards: app-data cache behavior must be tiered by surface instead of collapsing into one global TTL.
// Guards: every cache-policy branch exposes an explicit no-polling shape so query consumers can preserve their cadence without narrowing a partial union.
// Guards: category discovery is event-driven and must not resume periodic background polling.
describe("app data cache policy", () => {
  it("defines distinct tiers for remote browsing data and local persisted state", () => {
    expect(APP_DATA_CACHE_POLICIES.followedStreamStatus).toMatchObject({
      staleTime: 30_000,
      refetchInterval: 30_000,
      staleFirst: true,
      storage: "memory",
    });

    expect(APP_DATA_CACHE_POLICIES.searchResults).toMatchObject({
      staleTime: 300_000,
      gcTime: 600_000,
      refetchInterval: null,
      staleFirst: true,
      storage: "memory",
    });

    expect(APP_DATA_CACHE_POLICIES.categoryReference.refetchInterval).toBeNull();
    expect(APP_DATA_CACHE_POLICIES.categories.refetchInterval).toBeNull();

    expect(APP_DATA_CACHE_POLICIES.localUserState).toMatchObject({
      staleTime: null,
      gcTime: null,
      refetchInterval: null,
      staleFirst: false,
      storage: "persisted-local",
    });

    const remoteStaleTimes = new Set(
      Object.values(APP_DATA_CACHE_POLICIES)
        .filter((policy) => policy.storage === "memory")
        .map((policy) => policy.staleTime)
    );

    expect(remoteStaleTimes.size).toBeGreaterThan(1);
  });

  it("converts cache tiers into TanStack Query options", () => {
    expect(getQueryCacheOptions("followedStreamStatus")).toEqual({
      staleTime: 30_000,
      gcTime: 300_000,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
      placeholderData: expect.any(Function),
    });

    expect(getQueryCacheOptions("localUserState")).toEqual({
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchInterval: undefined,
      refetchIntervalInBackground: false,
    });
  });
});
