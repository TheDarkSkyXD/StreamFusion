/**
 * emote-store tests — focus on global-emote load coordination.
 *
 * What's exercised here:
 *  1. Per-platform dedup: two `loadGlobalEmotes('twitch')` calls in a row hit
 *     the manager exactly once. The loadedGlobalPlatforms Set is the
 *     authority — its `has(platform)` check short-circuits the second call.
 *  2. Cross-platform independence: `loadGlobalEmotes('twitch')` followed by
 *     `loadGlobalEmotes('kick')` runs each manager call once. This is the
 *     verification for the Finding 1 fix — the old shared `isLoading` boolean
 *     suppressed the second platform's load in multistream / quick-switch
 *     scenarios.
 *  3. Concurrent races: `Promise.all([twitch, kick])` both reach the manager.
 *     Same regression as (2) but kicked off in parallel rather than sequence,
 *     which is the actual multistream open-two-tiles case.
 *  4. Error path leaves loadedGlobalPlatforms empty so retry works.
 *  5. The legacy `globalEmotesLoaded` shape — now exposed via the
 *     `useGlobalEmotesLoaded` derived hook — flips true once any platform
 *     completes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadGlobalEmotesMock = vi.fn();
const loadChannelEmotesMock = vi.fn();
const clearChannelEmotesMock = vi.fn();

vi.mock("@/backend/services/emotes", () => ({
  emoteManager: {
    loadGlobalEmotes: (...args: unknown[]) => loadGlobalEmotesMock(...args),
    loadChannelEmotes: (...args: unknown[]) => loadChannelEmotesMock(...args),
    clearChannelEmotes: (...args: unknown[]) => clearChannelEmotesMock(...args),
    searchEmotes: () => [],
    getEmotesByProvider: () => new Map(),
    getAllEmotes: () => [],
  },
}));

import { useEmoteStore } from "@/store/emote-store";

function resetStore(): void {
  useEmoteStore.setState({
    isLoading: false,
    loadedGlobalPlatforms: new Set(),
    error: null,
    loadedChannels: new Set(),
    recentEmotes: [],
    favoriteEmotes: [],
    activeChannelId: null,
  });
}

beforeEach(() => {
  loadGlobalEmotesMock.mockReset();
  loadGlobalEmotesMock.mockResolvedValue(undefined);
  loadChannelEmotesMock.mockReset();
  loadChannelEmotesMock.mockResolvedValue(undefined);
  clearChannelEmotesMock.mockReset();
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("emote-store loadGlobalEmotes", () => {
  it("dedupes same-platform calls — manager.loadGlobalEmotes runs exactly once", async () => {
    const { loadGlobalEmotes } = useEmoteStore.getState();
    await loadGlobalEmotes("twitch");
    await loadGlobalEmotes("twitch");
    expect(loadGlobalEmotesMock).toHaveBeenCalledTimes(1);
    expect(loadGlobalEmotesMock).toHaveBeenCalledWith("twitch");
  });

  it("runs cross-platform loads independently — twitch then kick → 2 calls", async () => {
    // The Finding 1 regression: the old shared `isLoading` gate let the first
    // platform's load suppress the second. Per-platform in-flight map fixes it.
    const { loadGlobalEmotes } = useEmoteStore.getState();
    await loadGlobalEmotes("twitch");
    await loadGlobalEmotes("kick");
    expect(loadGlobalEmotesMock).toHaveBeenCalledTimes(2);
    expect(loadGlobalEmotesMock).toHaveBeenNthCalledWith(1, "twitch");
    expect(loadGlobalEmotesMock).toHaveBeenNthCalledWith(2, "kick");
  });

  it("concurrent twitch+kick (Promise.all) both reach the manager — multistream race", async () => {
    // Hold the manager calls open with a deferred resolve so the second
    // Promise.all participant cannot win a race with the first by completing
    // synchronously before the in-flight map registers.
    let resolveCount = 0;
    const resolvers: Array<() => void> = [];
    loadGlobalEmotesMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCount++;
          resolvers.push(resolve);
        })
    );

    const { loadGlobalEmotes } = useEmoteStore.getState();
    const both = Promise.all([loadGlobalEmotes("twitch"), loadGlobalEmotes("kick")]);

    // Both calls should have reached the manager (different in-flight keys).
    // Yield once so the in-flight registrations + mock invocations settle.
    await Promise.resolve();
    expect(resolveCount).toBe(2);

    // Resolve both and await to keep the test clean.
    for (const r of resolvers) r();
    await both;
    expect(loadGlobalEmotesMock).toHaveBeenCalledTimes(2);
    expect(loadGlobalEmotesMock).toHaveBeenCalledWith("twitch");
    expect(loadGlobalEmotesMock).toHaveBeenCalledWith("kick");
  });

  it("manager rejection sets error, leaves loadedGlobalPlatforms empty, allows retry", async () => {
    loadGlobalEmotesMock.mockRejectedValueOnce(new Error("boom"));
    const { loadGlobalEmotes } = useEmoteStore.getState();
    await loadGlobalEmotes("twitch");

    let state = useEmoteStore.getState();
    expect(state.error).toBe("Failed to load global emotes");
    expect(state.loadedGlobalPlatforms.has("twitch")).toBe(false);

    // Retry succeeds — the platform gate is empty so the second call runs.
    loadGlobalEmotesMock.mockResolvedValueOnce(undefined);
    await loadGlobalEmotes("twitch");
    state = useEmoteStore.getState();
    expect(state.loadedGlobalPlatforms.has("twitch")).toBe(true);
    expect(loadGlobalEmotesMock).toHaveBeenCalledTimes(2);
  });

  it("loadedGlobalPlatforms.size > 0 once a platform completes (legacy globalEmotesLoaded shape)", async () => {
    expect(useEmoteStore.getState().loadedGlobalPlatforms.size).toBe(0);
    await useEmoteStore.getState().loadGlobalEmotes("twitch");
    expect(useEmoteStore.getState().loadedGlobalPlatforms.size).toBeGreaterThan(0);
  });
});
