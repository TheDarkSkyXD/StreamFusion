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
import type { Emote } from "@/backend/services/emotes/emote-types";

const loadGlobalEmotesMock = vi.fn();
const loadChannelEmotesMock = vi.fn();
const clearChannelEmotesMock = vi.fn();
const clearAllMock = vi.fn();
const getAllEmotesMock = vi.fn();

// Mutable enabled-provider set so applyProviderPrefs's get/set/clear flow can be
// exercised against a realistic manager surface. Reset in beforeEach.
let enabledProviders = new Set<string>(["twitch", "kick", "bttv", "ffz", "7tv"]);

vi.mock("@/backend/services/emotes", () => ({
  emoteManager: {
    loadGlobalEmotes: (...args: unknown[]) => loadGlobalEmotesMock(...args),
    loadChannelEmotes: (...args: unknown[]) => loadChannelEmotesMock(...args),
    clearChannelEmotes: (...args: unknown[]) => clearChannelEmotesMock(...args),
    clearAll: (...args: unknown[]) => clearAllMock(...args),
    isProviderEnabled: (provider: string) => enabledProviders.has(provider),
    setProviderEnabled: (provider: string, enabled: boolean) => {
      if (enabled) enabledProviders.add(provider);
      else enabledProviders.delete(provider);
    },
    searchEmotes: () => [],
    getEmotesByProvider: () => new Map(),
    getAllEmotes: (...args: unknown[]) => getAllEmotesMock(...args),
  },
}));

import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";

function providerPrefs(
  overrides: Partial<Pick<ChatDisplayPreferences, "enable7tv" | "enableBttv" | "enableFfz">> = {}
) {
  return {
    enable7tv: DEFAULT_CHAT_DISPLAY_PREFERENCES.enable7tv,
    enableBttv: DEFAULT_CHAT_DISPLAY_PREFERENCES.enableBttv,
    enableFfz: DEFAULT_CHAT_DISPLAY_PREFERENCES.enableFfz,
    ...overrides,
  };
}

import { useEmoteStore } from "@/store/emote-store";

function makeEmote(overrides: Partial<Emote> = {}): Emote {
  return {
    id: "emote-1",
    name: "Wave",
    provider: "7tv",
    isGlobal: false,
    isAnimated: false,
    isZeroWidth: false,
    urls: {
      url1x: "https://cdn.example/emote-1/1x.webp",
      url2x: "https://cdn.example/emote-1/2x.webp",
    },
    ...overrides,
  };
}

function resetStore(): void {
  useEmoteStore.setState({
    isLoading: false,
    loadedGlobalPlatforms: new Set(),
    error: null,
    emoteRevision: 0,
    loadedChannels: new Set(),
    recentEmotes: [],
    recentEmotesByScope: {},
    legacyRecentEmotesByPlatform: {},
    favoriteEmotes: [],
    activeChannelId: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  loadGlobalEmotesMock.mockReset();
  loadGlobalEmotesMock.mockResolvedValue(undefined);
  loadChannelEmotesMock.mockReset();
  loadChannelEmotesMock.mockResolvedValue(undefined);
  clearChannelEmotesMock.mockReset();
  clearAllMock.mockReset();
  getAllEmotesMock.mockReset();
  getAllEmotesMock.mockReturnValue([]);
  enabledProviders = new Set(["twitch", "kick", "bttv", "ffz", "7tv"]);
  resetStore();
});

afterEach(() => {
  resetStore();
  localStorage.clear();
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

  it("force reloads a platform so authed account emotes are not skipped after globals loaded", async () => {
    const { loadGlobalEmotes } = useEmoteStore.getState();
    await loadGlobalEmotes("twitch");
    await loadGlobalEmotes("twitch", { force: true });

    expect(loadGlobalEmotesMock).toHaveBeenCalledTimes(2);
    expect(loadGlobalEmotesMock).toHaveBeenNthCalledWith(1, "twitch");
    expect(loadGlobalEmotesMock).toHaveBeenNthCalledWith(2, "twitch");
  });
});

describe("emote-store persisted picker state", () => {
  // Guards: favorite, frequently-used, and quick-bar emote state survives app restart.
  // Guards: signing out and back into the same platform account restores that account's quick emotes.
  it("restores a Twitch account's recent emotes after guest activity", () => {
    const accountScope = { platform: "twitch" as const, userId: "viewer-1" };
    const guestScope = { platform: "twitch" as const, userId: null };
    const accountEmote = makeEmote({ id: "account-1", name: "AccountWave", provider: "twitch" });
    const guestEmote = makeEmote({ id: "guest-1", name: "GuestWave", provider: "twitch" });

    useEmoteStore.getState().addRecentEmote(accountScope, accountEmote);
    useEmoteStore.getState().addRecentEmote(guestScope, guestEmote);

    expect(useEmoteStore.getState().getRecentEmotes(accountScope)).toEqual([accountEmote]);
    expect(useEmoteStore.getState().getRecentEmotes(guestScope)).toEqual([guestEmote]);
  });

  it("keeps Twitch and Kick accounts isolated across an app restart", async () => {
    const twitchA = { platform: "twitch" as const, userId: "twitch-a" };
    const twitchB = { platform: "twitch" as const, userId: "twitch-b" };
    const kickA = { platform: "kick" as const, userId: "kick-a" };
    const twitchEmote = makeEmote({ id: "shared-id", name: "TwitchWave", provider: "twitch" });
    const kickEmote = makeEmote({ id: "shared-id", name: "KickWave", provider: "kick" });

    useEmoteStore.getState().addRecentEmote(twitchA, twitchEmote);
    useEmoteStore.getState().addRecentEmote(kickA, kickEmote);

    expect(useEmoteStore.getState().getRecentEmotes(twitchB)).toEqual([]);

    vi.resetModules();
    const { useEmoteStore: freshEmoteStore } = await import("@/store/emote-store");

    expect(freshEmoteStore.getState().getRecentEmotes(twitchA)).toEqual([twitchEmote]);
    expect(freshEmoteStore.getState().getRecentEmotes(kickA)).toEqual([kickEmote]);
    expect(freshEmoteStore.getState().getRecentEmotes(twitchB)).toEqual([]);
  });

  it("clears only the requested viewer's recent emotes", () => {
    const viewerA = { platform: "kick" as const, userId: "viewer-a" };
    const viewerB = { platform: "kick" as const, userId: "viewer-b" };
    const emoteA = makeEmote({ id: "a", provider: "kick" });
    const emoteB = makeEmote({ id: "b", provider: "kick" });

    useEmoteStore.getState().addRecentEmote(viewerA, emoteA);
    useEmoteStore.getState().addRecentEmote(viewerB, emoteB);
    useEmoteStore.getState().clearRecentEmotes(viewerA);

    expect(useEmoteStore.getState().getRecentEmotes(viewerA)).toEqual([]);
    expect(useEmoteStore.getState().getRecentEmotes(viewerB)).toEqual([emoteB]);
  });

  it("does not collide when two providers use the same emote id", () => {
    const scope = { platform: "twitch" as const, userId: "viewer" };
    const twitchEmote = makeEmote({ id: "same", name: "Native", provider: "twitch" });
    const sevenTvEmote = makeEmote({ id: "same", name: "ThirdParty", provider: "7tv" });

    useEmoteStore.getState().addRecentEmote(scope, twitchEmote);
    useEmoteStore.getState().addRecentEmote(scope, sevenTvEmote);

    expect(useEmoteStore.getState().getRecentEmotes(scope)).toEqual([sevenTvEmote, twitchEmote]);
  });

  it("claims a legacy platform row atomically when the first account emote is selected", () => {
    const scope = { platform: "twitch" as const, userId: "viewer" };
    const legacyEmote = makeEmote({ id: "legacy", name: "Legacy", provider: "twitch" });
    const selectedEmote = makeEmote({ id: "selected", name: "Selected", provider: "7tv" });
    useEmoteStore.setState({
      legacyRecentEmotesByPlatform: { twitch: [legacyEmote] },
    });

    useEmoteStore.getState().addRecentEmote(scope, selectedEmote);

    expect(useEmoteStore.getState().getRecentEmotes(scope)).toEqual([selectedEmote, legacyEmote]);
    expect(useEmoteStore.getState().legacyRecentEmotesByPlatform.twitch).toBeUndefined();
  });

  it("migrates a legacy storage blob for one-time Twitch and Kick account claims", async () => {
    const twitchEmote = makeEmote({ id: "legacy-t", name: "LegacyTwitch", provider: "twitch" });
    const kickEmote = makeEmote({ id: "legacy-k", name: "LegacyKick", provider: "kick" });
    localStorage.setItem(
      "emote-storage",
      JSON.stringify({
        state: {
          recentEmotes: [twitchEmote, kickEmote],
          maxRecentEmotes: 20,
          favoriteEmotes: [],
        },
        version: 0,
      })
    );

    vi.resetModules();
    const { useEmoteStore: migratedStore } = await import("@/store/emote-store");
    const twitchScope = { platform: "twitch" as const, userId: "twitch-viewer" };
    const kickScope = { platform: "kick" as const, userId: "kick-viewer" };

    migratedStore.getState().claimLegacyRecentEmotes(twitchScope);
    migratedStore.getState().claimLegacyRecentEmotes(kickScope);

    expect(migratedStore.getState().getRecentEmotes(twitchScope)).toEqual([twitchEmote]);
    expect(migratedStore.getState().getRecentEmotes(kickScope)).toEqual([kickEmote]);
    expect(
      migratedStore.getState().getRecentEmotes({ platform: "twitch", userId: "different-viewer" })
    ).toEqual([]);
  });

  it("hydrates recent and favorite emotes from persisted storage without persisting load caches", async () => {
    const recentEmote = makeEmote({ id: "recent-1", name: "RecentWave", provider: "kick" });
    const favoriteEmote = makeEmote({ id: "favorite-1", name: "FavoriteStar", provider: "7tv" });

    useEmoteStore.setState({
      loadedGlobalPlatforms: new Set(["kick"]),
      loadedChannels: new Set(["channel-1"]),
    });
    useEmoteStore.getState().addRecentEmote(recentEmote);
    useEmoteStore.getState().toggleFavorite(favoriteEmote);

    const persisted = JSON.parse(localStorage.getItem("emote-storage") ?? "{}");
    expect(persisted.state.recentEmotes).toEqual([recentEmote]);
    expect(persisted.state.favoriteEmotes).toEqual([favoriteEmote]);
    expect(persisted.state.loadedGlobalPlatforms).toBeUndefined();
    expect(persisted.state.loadedChannels).toBeUndefined();

    vi.resetModules();
    const { useEmoteStore: freshEmoteStore } = await import("@/store/emote-store");

    expect(freshEmoteStore.getState().recentEmotes).toEqual([recentEmote]);
    expect(freshEmoteStore.getState().favoriteEmotes).toEqual([favoriteEmote]);
    expect(freshEmoteStore.getState().loadedGlobalPlatforms.size).toBe(0);
    expect(freshEmoteStore.getState().loadedChannels.size).toBe(0);
  });
});

describe("emote-store getEmoteNameMap", () => {
  it("reuses the emote name lookup until the active channel or emote revision changes", () => {
    getAllEmotesMock.mockReturnValue([
      {
        id: "clap",
        name: "Clap",
        provider: "7tv",
        isGlobal: false,
        urls: { url1x: "https://cdn.example/clap.webp", url2x: "https://cdn.example/clap.webp" },
      },
    ]);

    const first = useEmoteStore.getState().getEmoteNameMap();
    const second = useEmoteStore.getState().getEmoteNameMap();

    expect(second).toBe(first);
    expect(first.get("Clap")?.id).toBe("clap");
    expect(getAllEmotesMock).toHaveBeenCalledTimes(1);

    useEmoteStore.setState({ emoteRevision: 1 });
    const afterRevision = useEmoteStore.getState().getEmoteNameMap();

    expect(afterRevision).not.toBe(first);
    expect(getAllEmotesMock).toHaveBeenCalledTimes(2);

    useEmoteStore.setState({ activeChannelId: "chan-1" });
    useEmoteStore.getState().getEmoteNameMap();

    expect(getAllEmotesMock).toHaveBeenCalledTimes(3);
    expect(getAllEmotesMock).toHaveBeenLastCalledWith("chan-1");
  });
});

describe("emote-store applyProviderPrefs (U3)", () => {
  it("disabling a provider then reloading a channel excludes that provider", async () => {
    // Load globals + a channel so the tracking Sets are populated.
    const store = useEmoteStore.getState();
    await store.loadGlobalEmotes("twitch");
    await store.loadChannelEmotes("chan-1", "channel", "twitch");
    expect(useEmoteStore.getState().loadedGlobalPlatforms.has("twitch")).toBe(true);
    expect(useEmoteStore.getState().loadedChannels.has("chan-1")).toBe(true);

    // Disable 7TV — provider flips off, manager cache cleared, Sets reset so the
    // next load re-fetches with 7TV excluded.
    useEmoteStore.getState().applyProviderPrefs(providerPrefs({ enable7tv: false }));
    expect(enabledProviders.has("7tv")).toBe(false);
    expect(enabledProviders.has("bttv")).toBe(true);
    expect(enabledProviders.has("ffz")).toBe(true);
    expect(clearAllMock).toHaveBeenCalledTimes(1);
    expect(useEmoteStore.getState().loadedGlobalPlatforms.size).toBe(0);
    expect(useEmoteStore.getState().loadedChannels.size).toBe(0);

    // The reload gate is open again — the channel re-fetches.
    loadChannelEmotesMock.mockClear();
    await useEmoteStore.getState().loadChannelEmotes("chan-1", "channel", "twitch");
    expect(loadChannelEmotesMock).toHaveBeenCalledTimes(1);
    expect(useEmoteStore.getState().loadedChannels.has("chan-1")).toBe(true);
  });

  it("never toggles the first-party twitch/kick providers", () => {
    useEmoteStore.getState().applyProviderPrefs(providerPrefs({ enable7tv: false }));
    expect(enabledProviders.has("twitch")).toBe(true);
    expect(enabledProviders.has("kick")).toBe(true);
  });

  it("is a no-op when the enabled set already matches prefs", async () => {
    const store = useEmoteStore.getState();
    await store.loadGlobalEmotes("twitch");
    // All third-party providers already enabled — applying the all-on defaults
    // changes nothing, so the manager cache + tracking Sets are left intact.
    useEmoteStore.getState().applyProviderPrefs(providerPrefs());
    expect(clearAllMock).not.toHaveBeenCalled();
    expect(useEmoteStore.getState().loadedGlobalPlatforms.has("twitch")).toBe(true);
  });

  it("re-enabling a provider clears the Sets so its emotes reload", async () => {
    // Start with 7TV disabled.
    useEmoteStore.getState().applyProviderPrefs(providerPrefs({ enable7tv: false }));
    clearAllMock.mockClear();
    await useEmoteStore.getState().loadGlobalEmotes("twitch");
    expect(useEmoteStore.getState().loadedGlobalPlatforms.has("twitch")).toBe(true);

    // Re-enable 7TV — the set changes, so the cache + Sets are cleared again.
    useEmoteStore.getState().applyProviderPrefs(providerPrefs({ enable7tv: true }));
    expect(enabledProviders.has("7tv")).toBe(true);
    expect(clearAllMock).toHaveBeenCalledTimes(1);
    expect(useEmoteStore.getState().loadedGlobalPlatforms.size).toBe(0);
  });
});
