import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerWarnMock = vi.hoisted(() => vi.fn());
vi.mock("@/renderer/logging/logger", () => ({
  logger: { warn: loggerWarnMock },
}));

import {
  hydratePersistedBrowseSnapshots,
  hydratePersistedFollowingSnapshot,
  hydratePersistedFollowingSnapshots,
  useBrowseSnapshotBootstrap,
} from "@/hooks/queries/browse-snapshot-bootstrap";
import { resetPersistedChannelLruForTests } from "@/hooks/queries/persisted-channel-lru";
import { resetPersistedSearchLruForTests } from "@/hooks/queries/persisted-search-lru";
import { resetPersistedSearchResultsLruForTests } from "@/hooks/queries/persisted-search-results-lru";
import { CATEGORY_KEYS } from "@/hooks/queries/useCategories";
import { CHANNEL_KEYS } from "@/hooks/queries/useChannels";
import { SEARCH_KEYS } from "@/hooks/queries/useSearch";
import { createFollowedStreamSnapshotIdentity, STREAM_KEYS } from "@/hooks/queries/useStreams";
import {
  getRetainedViewportImageUrlsForTests,
  resetViewportImagePrewarmForTests,
} from "@/lib/viewport-image-prewarm";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import {
  getPersistedChatHistory,
  resetPersistedChatHistoryForTests,
} from "@/store/persisted-chat-history";
import { fixtures, installElectronAPIMock } from "../../test-utils";

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
  resetPersistedChannelLruForTests();
  resetPersistedSearchLruForTests();
  resetPersistedSearchResultsLruForTests();
  resetPersistedChatHistoryForTests();
  resetViewportImagePrewarmForTests();
  loggerWarnMock.mockReset();
  useAuthStore.setState({ initialized: false, twitchUser: null, kickUser: null });
  useFollowStore.setState({ localFollows: [], isHydrated: false });
});

// Guards: post-first-paint bootstrap seeds only fresh, non-empty, identity-valid fixed browse slots into their exact TanStack keys.
// Guards: Following startup hydration publishes cached streams only for the exact current account and follow-set identity.
// Guards: a delayed snapshot read from the previous identity cannot populate the shared followed-stream cache after account state changes.
// Guards: persisted Following streams hydrate as stale so cached cards paint while live status refreshes immediately.
// Guards: post-first-paint bootstrap warms persisted chat history before the first stream click.
// Guards: valid same-schema discovery data remains available offline regardless of age while future timestamps stay invalid
// Guards: malformed legacy broad-search snapshots cannot abort hydration of the validated exact-search LRU
// Guards: exact-search cache rejects corrupt runtime field types before publishing any part of an entry
describe("browse snapshot bootstrap", () => {
  it("does not read account-scoped following snapshots until auth and follows are both hydrated", async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    api.store.get = vi.fn(async () => null);
    useAuthStore.setState({ initialized: true });
    useFollowStore.setState({
      localFollows: [fixtures.channel({ id: "kick-follow", platform: "kick" })],
      isHydrated: false,
    });
    const client = new QueryClient();

    const { unmount } = renderHook(() => useBrowseSnapshotBootstrap(client));
    const browseFrame = frames.shift();
    await act(async () => browseFrame?.(0));
    expect(api.store.get).not.toHaveBeenCalledWith(expect.stringContaining("followed-streams:"));

    act(() => useFollowStore.setState({ isHydrated: true }));
    const followingFrame = frames.shift();
    await act(async () => followingFrame?.(16));

    await waitFor(() => {
      expect(api.store.get).toHaveBeenCalledWith("browse-query-snapshot:v1:followed-streams:all");
      expect(api.store.get).toHaveBeenCalledWith(
        "browse-query-snapshot:v1:followed-streams:twitch"
      );
      expect(api.store.get).toHaveBeenCalledWith("browse-query-snapshot:v1:followed-streams:kick");
    });
    unmount();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("discards an in-flight Following snapshot read when account identity changes", async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const oldFollow = fixtures.channel({ id: "old-follow", platform: "twitch" });
    const newFollow = fixtures.channel({ id: "new-follow", platform: "twitch" });
    const oldIdentity = createFollowedStreamSnapshotIdentity(undefined, "old-viewer", "guest", [
      oldFollow,
    ]);
    let resolveOldRead: ((snapshot: unknown) => void) | undefined;
    let allSlotReads = 0;
    api.store.get = vi.fn(async (key: string) => {
      if (key !== "browse-query-snapshot:v1:followed-streams:all") return null;
      allSlotReads += 1;
      if (allSlotReads > 1) return null;
      return new Promise((resolve) => {
        resolveOldRead = resolve;
      });
    });
    useAuthStore.setState({
      initialized: true,
      twitchUser: { id: "old-viewer" } as never,
      kickUser: null,
    });
    useFollowStore.setState({ localFollows: [oldFollow], isHydrated: true });
    const client = new QueryClient();

    const { unmount } = renderHook(() => useBrowseSnapshotBootstrap(client));
    frames[1]?.(0);
    await waitFor(() => expect(resolveOldRead).toBeTypeOf("function"));

    act(() => {
      useAuthStore.setState({ twitchUser: { id: "new-viewer" } as never });
      useFollowStore.setState({ localFollows: [newFollow] });
    });
    frames.at(-1)?.(16);
    resolveOldRead?.({
      version: 1,
      identity: JSON.stringify(oldIdentity),
      savedAt: Date.now(),
      data: [fixtures.stream({ id: "old-account-live" })],
    });

    await waitFor(() => expect(allSlotReads).toBeGreaterThan(1));
    expect(client.getQueryData(STREAM_KEYS.followed())).toBeUndefined();
    unmount();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("handles rejected post-paint browse and following hydration promises", async () => {
    api.store.get = vi.fn(async () => {
      throw new Error("store IPC unavailable during startup");
    });
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { unmount } = renderHook(() => useBrowseSnapshotBootstrap(new QueryClient()));

    for (const frame of frames) frame(0);

    await waitFor(() => expect(loggerWarnMock).toHaveBeenCalled());
    unmount();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("hydrates cached chat history after first paint before a stream click", async () => {
    const timestamp = new Date("2026-07-14T12:00:00.000Z");
    api.store.get = vi.fn(async (key: string) =>
      key === "chat-history-lru:v1"
        ? {
            version: 1,
            entries: [
              {
                platform: "kick",
                channel: "blame",
                channelId: "411439",
                savedAt: Date.now(),
                messages: [
                  {
                    id: "cached-1",
                    platform: "kick",
                    type: "message",
                    channel: "blame",
                    userId: "viewer-1",
                    username: "viewer",
                    displayName: "Viewer",
                    color: "#53fc18",
                    badges: [],
                    content: [{ type: "text", content: "cached context" }],
                    rawContent: "cached context",
                    timestamp: timestamp.toISOString(),
                    isDeleted: false,
                    isHighlighted: false,
                    isAction: false,
                    isHistorical: true,
                  },
                ],
              },
            ],
          }
        : null
    );

    await hydratePersistedBrowseSnapshots(new QueryClient());

    expect(getPersistedChatHistory("kick", "BLAME", "411439")?.[0]).toMatchObject({
      id: "cached-1",
      timestamp,
    });
  });

  it("hydrates exact recent channel metadata as stale before a cold stream click", async () => {
    const kickChannel = fixtures.channel({
      id: "kick-blame",
      platform: "kick",
      username: "Blame",
      chatroomId: 98765,
    });
    api.store.get = vi.fn(async (key: string) =>
      key === "channel-metadata-lru:v1"
        ? {
            version: 1,
            entries: [
              {
                platform: "kick",
                username: "blame",
                savedAt: Date.now(),
                data: kickChannel,
              },
            ],
          }
        : null
    );
    const client = new QueryClient();

    await hydratePersistedBrowseSnapshots(client);

    const exactKey = CHANNEL_KEYS.byUsername("  BLAME ", "kick");
    expect(client.getQueryData(exactKey)).toMatchObject({
      id: "kick-blame",
      chatroomId: 98765,
    });
    expect(client.getQueryState(exactKey)?.dataUpdatedAt).toBe(0);
    expect(client.getQueryData(CHANNEL_KEYS.byUsername("blame", "twitch"))).toBeUndefined();
    expect(client.getQueryData(CHANNEL_KEYS.byUsername("other", "kick"))).toBeUndefined();
  });

  it("hydrates Home, Categories, and exact last-search cache keys", async () => {
    const stream = fixtures.stream({ id: "home-1" });
    const category = fixtures.category({ id: "cat-1" });
    const channel = fixtures.channel({ id: "search-1", platform: "twitch" });
    api.store.get = vi.fn(async (key: string) => {
      if (key.endsWith("top-streams:all")) {
        return {
          version: 1,
          identity: JSON.stringify(JSON.stringify({ platform: "all", limit: 25 })),
          savedAt: Date.now(),
          data: [stream],
        };
      }
      if (key.endsWith("categories:all")) {
        return {
          version: 1,
          identity: JSON.stringify("all"),
          savedAt: Date.now(),
          data: [category],
        };
      }
      if (key.endsWith("search:twitch")) {
        return {
          version: 1,
          identity: JSON.stringify(JSON.stringify({ query: "xqc", platform: "twitch", limit: 20 })),
          savedAt: Date.now(),
          data: { channels: [channel], categories: [], streams: [], videos: [], clips: [] },
        };
      }
      return null;
    });
    const client = new QueryClient();

    await hydratePersistedBrowseSnapshots(client);

    expect(client.getQueryData(STREAM_KEYS.top(undefined, 25))).toEqual([stream]);
    expect(client.getQueryData(CATEGORY_KEYS.top(undefined))).toEqual([category]);
    expect(client.getQueryData(SEARCH_KEYS.everything("xqc", "twitch", 20))).toEqual({
      channels: [channel],
      categories: [],
      streams: [],
      videos: [],
      clips: [],
    });
  });

  it("hydrates an old but valid category catalog as stale for an offline restart", async () => {
    const category = fixtures.category({ id: "old-category", name: "Old But Useful" });
    api.store.get = vi.fn(async (key: string) =>
      key.endsWith("categories:all")
        ? {
            version: 1,
            identity: JSON.stringify("all"),
            savedAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
            data: [category],
          }
        : null
    );
    const client = new QueryClient();

    await hydratePersistedBrowseSnapshots(client);

    expect(client.getQueryData(CATEGORY_KEYS.top(undefined))).toEqual([category]);
    expect(client.getQueryState(CATEGORY_KEYS.top(undefined))?.dataUpdatedAt).toBe(0);
  });

  it("hydrates an old but valid exact search result as stale for an offline restart", async () => {
    const channel = fixtures.channel({
      id: "old-search-channel",
      username: "oldsearch",
      displayName: "Old Search",
    });
    const data = { channels: [channel], categories: [], streams: [], videos: [], clips: [] };
    api.store.get = vi.fn(async (key: string) =>
      key === "search-results-lru:v1"
        ? {
            version: 1,
            entries: [
              {
                query: "old search",
                limit: 5,
                savedAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
                data,
              },
            ],
          }
        : null
    );
    const client = new QueryClient();

    await hydratePersistedBrowseSnapshots(client);

    expect(client.getQueryData(SEARCH_KEYS.everything("old search", undefined, 5))).toEqual(data);
    expect(
      client.getQueryState(SEARCH_KEYS.everything("old search", undefined, 5))?.dataUpdatedAt
    ).toBe(0);
  });

  it("ignores a malformed legacy broad search snapshot and still hydrates the exact LRU", async () => {
    const channel = fixtures.channel({
      id: "valid-lru-after-malformed-legacy",
      username: "validlru",
      displayName: "Valid LRU",
    });
    const data = { channels: [channel], categories: [], streams: [], videos: [], clips: [] };
    api.store.get = vi.fn(async (key: string) => {
      if (key === "browse-query-snapshot:v1:search:twitch") {
        return {
          version: 1,
          identity: JSON.stringify(
            JSON.stringify({ query: "malformed", platform: "twitch", limit: 20 })
          ),
          savedAt: Date.now(),
          data: { channels: "not-an-array" },
        };
      }
      if (key === "search-results-lru:v1") {
        return {
          version: 1,
          entries: [{ query: "valid lru", limit: 5, savedAt: Date.now(), data }],
        };
      }
      return null;
    });
    const client = new QueryClient();

    await expect(hydratePersistedBrowseSnapshots(client)).resolves.toBeUndefined();

    expect(client.getQueryData(SEARCH_KEYS.everything("valid lru", undefined, 5))).toEqual(data);
    expect(client.getQueryData(SEARCH_KEYS.everything("malformed", "twitch", 20))).toBeUndefined();
  });

  it("rejects an exact search cache entry with an invalid persisted media type", async () => {
    const corruptData: unknown = {
      channels: [],
      categories: [],
      streams: [],
      videos: [
        {
          id: "corrupt-video",
          platform: "twitch",
          channelId: "channel-1",
          channelName: "corrupt",
          channelDisplayName: "Corrupt",
          channelAvatar: "",
          title: "Corrupt persisted type",
          thumbnailUrl: "",
          duration: 10,
          viewCount: 1,
          publishedAt: "2026-01-01T00:00:00.000Z",
          url: "https://example.com/video",
          type: "trailer",
        },
      ],
      clips: [],
    };
    api.store.get = vi.fn(async (key: string) =>
      key === "search-results-lru:v1"
        ? {
            version: 1,
            entries: [
              {
                query: "corrupt type",
                limit: 5,
                savedAt: Date.now(),
                data: corruptData,
              },
            ],
          }
        : null
    );
    const client = new QueryClient();

    await hydratePersistedBrowseSnapshots(client);

    expect(
      client.getQueryData(SEARCH_KEYS.everything("corrupt type", undefined, 5))
    ).toBeUndefined();
  });

  it("rejects stale and slot-mismatched snapshots", async () => {
    api.store.get = vi.fn(async (key: string) =>
      key.endsWith("top-streams:all")
        ? {
            version: 1,
            identity: JSON.stringify(JSON.stringify({ platform: "kick", limit: 25 })),
            savedAt: Date.now() - 11 * 60 * 1000,
            data: [fixtures.stream()],
          }
        : null
    );
    const client = new QueryClient();

    await hydratePersistedBrowseSnapshots(client);

    expect(client.getQueryData(STREAM_KEYS.top(undefined, 25))).toBeUndefined();
  });

  it("hydrates the exact real category header and both platform stream keys from stale snapshots", async () => {
    const savedAt = Date.now() - 20 * 60 * 1000;
    const category = fixtures.category({
      id: "509658",
      platform: "twitch",
      name: "Just Chatting",
      crossPlatformId: "15",
    });
    const twitchStream = fixtures.stream({
      id: "twitch-just-chatting",
      platform: "twitch",
      categoryId: "509658",
      categoryName: "Just Chatting",
    });
    const kickStream = fixtures.stream({
      id: "kick-just-chatting",
      platform: "kick",
      categoryId: "15",
      categoryName: "Just Chatting",
    });
    api.store.get = vi.fn(async (key: string) => {
      if (key.endsWith("categories:all")) {
        return {
          version: 1,
          identity: JSON.stringify("all"),
          savedAt,
          data: [category],
        };
      }
      if (key.endsWith("category-streams:twitch")) {
        return {
          version: 1,
          identity: JSON.stringify(
            JSON.stringify({
              categoryId: "509658",
              platform: "twitch",
              limit: 30,
              categoryName: "",
              language: "",
            })
          ),
          savedAt,
          data: { pages: [{ success: true, data: [twitchStream] }], pageParams: [undefined] },
        };
      }
      if (key.endsWith("category-streams:kick")) {
        return {
          version: 1,
          identity: JSON.stringify(
            JSON.stringify({
              categoryId: "15",
              platform: "kick",
              limit: 30,
              categoryName: "Just Chatting",
              language: "",
            })
          ),
          savedAt,
          data: { pages: [{ success: true, data: [kickStream] }], pageParams: [undefined] },
        };
      }
      return null;
    });
    const client = new QueryClient();

    await hydratePersistedBrowseSnapshots(client);

    expect(client.getQueryData(CATEGORY_KEYS.top(undefined))).toEqual([category]);
    expect(client.getQueryData(CATEGORY_KEYS.byId("509658", "twitch"))).toBeUndefined();
    expect(
      client.getQueryData([
        ...STREAM_KEYS.byCategory("509658", "twitch"),
        "infinite",
        undefined,
        undefined,
      ])
    ).toEqual({ pages: [{ success: true, data: [twitchStream] }], pageParams: [undefined] });
    expect(
      client.getQueryData([
        ...STREAM_KEYS.byCategory("15", "kick"),
        "infinite",
        "Just Chatting",
        undefined,
      ])
    ).toEqual({ pages: [{ success: true, data: [kickStream] }], pageParams: [undefined] });
    expect(client.getQueryState(CATEGORY_KEYS.top(undefined))?.dataUpdatedAt).toBe(0);
  });

  it("hydrates an exact current-account Following snapshot before route navigation", async () => {
    const stream = fixtures.stream({ id: "followed-1" });
    const identity = {
      platform: "all",
      twitchUserId: "viewer-1",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;
    api.store.get = vi.fn(async () => ({
      version: 1,
      identity: JSON.stringify(identity),
      savedAt: Date.now(),
      data: [stream],
    }));
    const client = new QueryClient();

    await hydratePersistedFollowingSnapshot(client, identity);

    expect(client.getQueryData(STREAM_KEYS.followed())).toEqual([stream]);
    expect(client.getQueryState(STREAM_KEYS.followed())?.dataUpdatedAt).toBe(0);
  });

  it("hydrates combined and platform followed keys after exact account and follow identity settles", async () => {
    const twitchFollow = fixtures.channel({
      id: "twitch-follow-1",
      platform: "twitch",
      username: "twitchfollow",
    });
    const kickFollow = fixtures.channel({
      id: "kick-follow-1",
      platform: "kick",
      username: "kickfollow",
    });
    const follows = [twitchFollow, kickFollow];
    const twitchStream = fixtures.stream({ id: "twitch-live", platform: "twitch" });
    const kickStream = fixtures.stream({ id: "kick-live", platform: "kick" });
    const snapshots = new Map(
      ([undefined, "twitch", "kick"] as const).map((platform) => {
        const identity = createFollowedStreamSnapshotIdentity(
          platform,
          "twitch-viewer",
          "kick-viewer",
          follows
        );
        const data =
          platform === "twitch"
            ? [twitchStream]
            : platform === "kick"
              ? [kickStream]
              : [twitchStream, kickStream];
        return [
          `browse-query-snapshot:v1:followed-streams:${platform ?? "all"}`,
          {
            version: 1,
            identity: JSON.stringify(identity),
            savedAt: Date.now() - 20 * 60 * 1000,
            data,
          },
        ];
      })
    );
    api.store.get = vi.fn(async (key: string) => snapshots.get(key) ?? null);
    const client = new QueryClient();

    await hydratePersistedFollowingSnapshots(client, {
      twitchUserId: "twitch-viewer",
      kickUserId: "kick-viewer",
      follows,
    });

    expect(client.getQueryData(STREAM_KEYS.followed())).toEqual([twitchStream, kickStream]);
    expect(client.getQueryData(STREAM_KEYS.followed("twitch"))).toEqual([twitchStream]);
    expect(client.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([kickStream]);
  });

  it("prewarms cached live and offline sidebar avatars during exact following hydration", async () => {
    const loadedImages: string[] = [];
    class ImmediateImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "auto";
      fetchPriority = "auto";
      set src(value: string) {
        loadedImages.push(value);
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", ImmediateImage);
    const offlineAvatar = "https://example.com/offline-avatar.webp";
    const liveAvatar = "https://example.com/live-avatar.webp";
    const follow = fixtures.channel({
      id: "kick-offline",
      platform: "kick",
      avatarUrl: offlineAvatar,
    });
    const identity = createFollowedStreamSnapshotIdentity(undefined, "guest", "kick-viewer", [
      follow,
    ]);
    api.store.get = vi.fn(async (key: string) =>
      key.endsWith("followed-streams:all")
        ? {
            version: 1,
            identity: JSON.stringify(identity),
            savedAt: Date.now(),
            data: [fixtures.stream({ platform: "kick", channelAvatar: liveAvatar })],
          }
        : null
    );

    await hydratePersistedFollowingSnapshots(new QueryClient(), {
      twitchUserId: "guest",
      kickUserId: "kick-viewer",
      follows: [follow],
    });

    await waitFor(() =>
      expect(getRetainedViewportImageUrlsForTests()).toEqual(
        expect.arrayContaining([offlineAvatar, liveAvatar])
      )
    );
    expect(loadedImages).toEqual(expect.arrayContaining([offlineAvatar, liveAvatar]));
    vi.unstubAllGlobals();
  });

  it("rejects a Following snapshot from a different account or follow set", async () => {
    const storedIdentity = {
      platform: "all",
      twitchUserId: "previous-viewer",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;
    const currentIdentity = {
      platform: "all",
      twitchUserId: "current-viewer",
      kickUserId: "guest",
      follows: ["twitch:channel-2"],
    } as const;
    api.store.get = vi.fn(async () => ({
      version: 1,
      identity: JSON.stringify(storedIdentity),
      savedAt: Date.now(),
      data: [fixtures.stream({ id: "foreign-followed-stream" })],
    }));
    const client = new QueryClient();

    await hydratePersistedFollowingSnapshot(client, currentIdentity);

    expect(client.getQueryData(STREAM_KEYS.followed())).toBeUndefined();
  });

  it("rejects a Following snapshot older than 24 hours", async () => {
    const identity = {
      platform: "all",
      twitchUserId: "viewer-1",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;
    api.store.get = vi.fn(async () => ({
      version: 1,
      identity: JSON.stringify(identity),
      savedAt: Date.now() - 24 * 60 * 60 * 1000 - 1,
      data: [fixtures.stream({ id: "expired-followed-stream" })],
    }));
    const client = new QueryClient();

    await hydratePersistedFollowingSnapshot(client, identity);

    expect(client.getQueryData(STREAM_KEYS.followed())).toBeUndefined();
  });

  it("rejects an empty Following snapshot", async () => {
    const identity = {
      platform: "all",
      twitchUserId: "viewer-1",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;
    api.store.get = vi.fn(async () => ({
      version: 1,
      identity: JSON.stringify(identity),
      savedAt: Date.now(),
      data: [],
    }));
    const client = new QueryClient();

    await hydratePersistedFollowingSnapshot(client, identity);

    expect(client.getQueryData(STREAM_KEYS.followed())).toBeUndefined();
  });
});
