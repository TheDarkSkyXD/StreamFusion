import { afterEach, describe, expect, it, vi } from "vitest";

import {
  invalidateFollowCachesAfterMutation,
  invalidatePlatformRecoveryCaches,
  removePlatformAccountCaches,
} from "./cache-invalidation";
import { getCachePerformanceSamples, resetCachePerformanceSamples } from "./cache-performance";

// Guards: follow/auth/platform events must target affected cache families without clearing unrelated browse state.
describe("app data cache invalidation", () => {
  afterEach(() => {
    resetCachePerformanceSamples();
  });

  it("invalidates follow-related caches after a follow mutation", () => {
    const client = {
      invalidateQueries: vi.fn(),
      removeQueries: vi.fn(),
    };

    invalidateFollowCachesAfterMutation(client, "kick");

    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["channels", "followed", "kick"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["streams", "followed", "kick"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["streams", "followed", undefined],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["followed-content"],
    });
    expect(client.removeQueries).not.toHaveBeenCalled();
    expect(getCachePerformanceSamples("cache-invalidation")).toEqual([
      expect.objectContaining({
        surface: "follow-mutation:kick",
        withinBudget: true,
      }),
    ]);
  });

  it("removes account-owned follow caches after auth loss", () => {
    const client = {
      invalidateQueries: vi.fn(),
      removeQueries: vi.fn(),
    };

    removePlatformAccountCaches(client, "twitch");

    expect(client.removeQueries).toHaveBeenCalledWith({
      queryKey: ["channels", "followed", "twitch"],
    });
    expect(client.removeQueries).toHaveBeenCalledWith({
      queryKey: ["streams", "followed", "twitch"],
    });
    expect(client.removeQueries).toHaveBeenCalledWith({
      queryKey: ["streams", "followed", undefined],
    });
    expect(client.removeQueries).toHaveBeenCalledWith({
      queryKey: ["followed-content"],
    });
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    expect(getCachePerformanceSamples("cache-invalidation")).toEqual([
      expect.objectContaining({
        surface: "account-cache-remove:twitch",
        withinBudget: true,
      }),
    ]);
  });

  it("refreshes stream caches for a recovered platform without touching search caches", () => {
    const client = {
      invalidateQueries: vi.fn(),
      removeQueries: vi.fn(),
    };

    invalidatePlatformRecoveryCaches(client, "kick");

    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["streams"],
      predicate: expect.any(Function),
    });
    expect(client.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["search"],
    });
    expect(client.removeQueries).not.toHaveBeenCalled();
    expect(getCachePerformanceSamples("cache-invalidation")).toEqual([
      expect.objectContaining({
        surface: "platform-recovery:kick",
        withinBudget: true,
      }),
    ]);
  });
});
