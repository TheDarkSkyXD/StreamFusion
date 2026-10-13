import { describe, expect, it, vi } from "vitest";
import { createRelaySuccessEnvelope } from "@streamfusion/core/relay";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  guestFollowKey,
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";

import type {
  DisposableCache,
  GuestFollowRepository,
  LiveNotificationPreferenceStore,
} from "@mobile/features/storage/capabilities/persistence";
import type { LiveStreamCatalog } from "@mobile/features/discovery/capabilities/live-stream-catalog";
import { createFollowingRuntime } from "../composition/following-runtime";
import { guestFollow } from "../domain/following-fixtures";

vi.mock("expo-linking", () => ({
  openURL: vi.fn(async () => undefined),
}));

function memoryCache(): DisposableCache {
  const rows = new Map<
    string,
    { freshness: number; payload: string; storedAt: number }
  >();
  return {
    async clear() {
      rows.clear();
    },
    async get(key) {
      const row = rows.get(key);
      if (!row) return { kind: "miss" };
      const ageMilliseconds = Date.now() - row.storedAt;
      return {
        ageMilliseconds,
        kind: "hit",
        payload: row.payload,
        stale: ageMilliseconds > row.freshness,
      };
    },
    async put(options) {
      rows.set(options.key, {
        freshness: options.freshnessMilliseconds ?? 300_000,
        payload: options.payload,
        storedAt: Date.now(),
      });
    },
  };
}

function memoryGuestFollows(
  initial: readonly GuestFollow[] = [],
): GuestFollowRepository {
  let rows = [...initial];
  return {
    async list() {
      return rows;
    },
    async remove(identity) {
      rows = rows.filter(
        (follow) =>
          !(
            follow.platform === identity.platform &&
            follow.channelId === identity.channelId
          ),
      );
    },
    async upsert(value) {
      const follow = parseGuestFollowWrite(value);
      if (follow === null) throw new RangeError("invalid Guest Follow");
      rows = [
        ...rows.filter((row) => guestFollowKey(row) !== guestFollowKey(follow)),
        follow,
      ];
      return follow;
    },
  };
}

function memoryNotifications(): LiveNotificationPreferenceStore {
  let prefs = DEFAULT_LIVE_NOTIFICATION_PREFERENCES;
  return {
    async read() {
      return prefs;
    },
    async write(value) {
      prefs = value as typeof prefs;
      return prefs;
    },
  };
}

function gqlUser(input: {
  readonly id: string;
  readonly login: string;
  readonly stream?: object | null;
}) {
  return {
    data: {
      user: {
        description: "",
        displayName: input.login,
        id: input.id,
        login: input.login,
        profileImageURL: "https://example.test/avatar.png",
        roles: { isAffiliate: false, isPartner: false },
        stream: input.stream === undefined ? null : input.stream,
      },
    },
  };
}

function envelope(body: object) {
  return createRelaySuccessEnvelope({
    body: JSON.parse(JSON.stringify(body)),
    requestId: "req-1",
  });
}

describe("createFollowingRuntime", () => {
  it("keeps each provider read's time and membership when older hydration finishes last", async () => {
    let clock = 100;
    let finishFirstAccountRead: (streams: readonly never[]) => void = () =>
      undefined;
    const firstAccountRead = new Promise<readonly never[]>((resolve) => {
      finishFirstAccountRead = resolve;
    });
    let accountReads = 0;
    let streamReads = 0;
    const requestedVariables: unknown[] = [];
    const hydrated: unknown[] = [];
    const guestFollows = memoryGuestFollows([
      guestFollow({
        platform: "twitch",
        channelLogin: "channel",
        channelId: "123",
      }),
    ]);
    const list = vi.spyOn(guestFollows, "list");
    const session = createFollowingRuntime({
      cache: memoryCache(),
      guestFollows,
      installation: async () => ({ kind: "none" }),
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      now: () => clock,
      accountLiveStreams: [
        {
          read: () =>
            ++accountReads === 1 ? firstAccountRead : Promise.resolve([]),
        },
      ],
      fetch: async (_url, init) => {
        requestedVariables.push(JSON.parse(String(init?.body)).variables);
        return new Response(
          JSON.stringify(
            gqlUser({
              id: "123",
              login: "channel",
              stream: { id: `session-${++streamReads}` },
            }),
          ),
        );
      },
      onLiveHydrated: (value) => {
        hydrated.push(value);
      },
      relayBaseUrl: "http://relay.test/",
    });
    const first = session.hydrateLive();
    await vi.waitFor(() => expect(streamReads).toBe(1));
    clock = 200;
    await session.hydrateLive();
    clock = 300;
    finishFirstAccountRead([]);
    await first;
    expect(hydrated).toMatchObject([
      {
        membership: [{ channelId: "123" }],
        observedAtMs: { twitch: 200, kick: 200, account: 200 },
        outcomes: { twitch: { items: [{ id: "session-2" }] } },
      },
      {
        membership: [{ channelId: "123" }],
        observedAtMs: { twitch: 100, kick: 100, account: 100 },
        outcomes: { twitch: { items: [{ id: "session-1" }] } },
      },
    ]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(requestedVariables).toEqual([{ id: "123" }, { id: "123" }]);
  });

  it("signals successful local follow and notification changes", async () => {
    const changed: string[][] = [];
    const session = createFollowingRuntime({
      cache: memoryCache(),
      guestFollows: memoryGuestFollows(),
      installation: async () => ({ kind: "none" }),
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      onLocalChange: () => {
        void session.listMembership().then((membership) => {
          changed.push(membership.map((follow) => follow.channelId));
        });
      },
      relayBaseUrl: "http://relay.test/",
    });
    await session.mutateFollow({
      channelId: "1234",
      channelLogin: "spreen",
      platform: "kick",
    });
    await vi.waitFor(() => expect(changed).toEqual([["1234"]]));
    await session.removeGuestFollow({ platform: "kick", channelId: "1234" });
    await vi.waitFor(() => expect(changed).toEqual([["1234"], []]));
    await session.writeNotifications({
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      sound: false,
    });
    await vi.waitFor(() => expect(changed).toEqual([["1234"], [], []]));
    await session.removeGuestFollow({ platform: "kick", channelId: "1234" });
    expect(changed).toEqual([["1234"], [], []]);
  });
  it("adds Spreen as a Kick guest follow and reads live and recorded content without relay", async () => {
    const guestFollows = memoryGuestFollows();
    const urls: string[] = [];
    const kickLiveCatalog: LiveStreamCatalog = {
      read: async () => ({
        kind: "ready",
        entries: [
          {
            channel: {
              avatarUrl: "https://example.test/spreen.png",
              displayName: "Spreen",
              id: "1234",
              isLive: true,
              isPartner: true,
              isVerified: true,
              platform: "kick",
              username: "spreen",
            },
            playbackUrl: null,
            stream: {
              channelAvatar: "https://example.test/spreen.png",
              channelDisplayName: "Spreen",
              channelId: "1234",
              channelName: "spreen",
              id: "live-1",
              isLive: true,
              language: "es",
              platform: "kick",
              startedAt: null,
              tags: [],
              thumbnailUrl: "https://example.test/live.png",
              title: "Spreen live",
              viewerCount: 100,
            },
          },
        ],
      }),
    };
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/videos")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 99,
                  session_title: "Recent stream",
                  created_at: "2026-09-30T00:00:00.000Z",
                  duration: 60000,
                  views: 20,
                },
              ],
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      guestFollows,
      installation: async () => ({ kind: "none" }),
      kickLiveCatalog,
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    const followed = await session.mutateFollow({
      channelLogin: "Spreen",
      platform: "kick",
    });
    expect(followed).toMatchObject({
      kind: "followed",
      follow: {
        channelId: "1234",
        channelLogin: "spreen",
        displayName: "Spreen",
      },
    });
    expect((await session.hydrateLive()).kick.items).toMatchObject([
      { channelId: "1234", title: "Spreen live" },
    ]);
    const recorded = await session.hydrateRecorded({
      channelId: "1234",
      channelLogin: "spreen",
      kind: "videos",
      platform: "kick",
      sort: "recent",
    });
    expect(recorded).toMatchObject({
      failed: false,
      items: [{ channelId: "1234", id: "99", title: "Recent stream" }],
    });
    expect(urls).toEqual([
      "https://kick.com/api/v2/channels/spreen/videos?limit=20",
    ]);
    expect(await guestFollows.list()).toHaveLength(1);
  });

  it("resolves an offline Kick channel through the public channel page", async () => {
    const urls: string[] = [];
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        return new Response(
          JSON.stringify({
            id: 456,
            slug: "offlinecreator",
            user: { username: "OfflineCreator", profilepic: "" },
          }),
        );
      },
      guestFollows: memoryGuestFollows(),
      installation: async () => ({ kind: "none" }),
      kickLiveCatalog: { read: async () => ({ kind: "ready", entries: [] }) },
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    expect(
      await session.mutateFollow({
        channelLogin: "offlinecreator",
        platform: "kick",
      }),
    ).toMatchObject({
      kind: "followed",
      follow: { channelId: "456", channelLogin: "offlinecreator" },
    });
    expect(urls).toEqual(["https://kick.com/api/v1/channels/offlinecreator"]);
  });

  it("hydrates a live Kick follow omitted from the directory", async () => {
    const urls: string[] = [];
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            id: 456,
            slug: "smallcreator",
            user: { username: "SmallCreator", profilepic: "" },
            livestream: {
              id: 999,
              is_live: true,
              session_title: "Live now",
              viewer_count: 12,
            },
          }),
        );
      },
      guestFollows: memoryGuestFollows([
        guestFollow({
          channelId: "456",
          channelLogin: "smallcreator",
          platform: "kick",
        }),
      ]),
      installation: async () => ({ kind: "none" }),
      kickLiveCatalog: { read: async () => ({ kind: "ready", entries: [] }) },
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    expect((await session.hydrateLive()).kick.items).toMatchObject([
      { channelId: "456", id: "999", title: "Live now" },
    ]);
    expect(urls).toEqual(["https://kick.com/api/v1/channels/smallcreator"]);
  });

  it("retains the relay when a public Kick channel read fails", async () => {
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        const url = String(input);
        if (url.startsWith("https://kick.com/"))
          return new Response("", { status: 503 });
        if (url.includes("followed-content/channels")) {
          return new Response(
            JSON.stringify(
              envelope({
                channels: [
                  {
                    avatarUrl: "",
                    displayName: "Spreen",
                    id: "1234",
                    isLive: false,
                    isPartner: false,
                    isVerified: false,
                    platform: "kick",
                    username: "spreen",
                  },
                ],
                missing: [],
                platform: "kick",
              }),
            ),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      guestFollows: memoryGuestFollows(),
      installation: async () => ({ credential: "install", kind: "ready" }),
      kickLiveCatalog: {
        read: async () => ({
          failure: { kind: "provider-rejected", status: 503 },
          kind: "unavailable",
        }),
      },
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    expect(
      await session.mutateFollow({
        channelLogin: "spreen",
        platform: "kick",
      }),
    ).toMatchObject({
      kind: "followed",
      follow: { channelId: "1234", channelLogin: "spreen" },
    });
  });

  it("persists twitch guest follow for xqc so Activity live alerts can target it", async () => {
    const guestFollows = memoryGuestFollows();
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async () => {
        throw new Error("relay should not be called for known xqc identity");
      },
      guestFollows,
      installation: async () => ({ kind: "none" }),
      liveNotifications: memoryNotifications(),
      network: async () => "offline",
      now: () => Date.parse("2026-09-23T11:00:00.000Z"),
      relayBaseUrl: "http://relay.test/",
    });
    const followed = await session.mutateFollow({
      channelId: "71092938",
      channelLogin: "xqc",
      displayName: "xQc",
      platform: "twitch",
    });
    expect(followed).toMatchObject({
      kind: "followed",
      follow: {
        channelId: "71092938",
        channelLogin: "xqc",
        displayName: "xQc",
        platform: "twitch",
      },
    });
    const membership = await session.listMembership();
    expect(membership).toEqual([
      expect.objectContaining({
        channelId: "71092938",
        channelLogin: "xqc",
        displayName: "xQc",
        platform: "twitch",
      }),
    ]);
  });

  it("persists Guest Follows from known channel identity without relay resolve", async () => {
    const guestFollows = memoryGuestFollows();
    let fetchCount = 0;
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async () => {
        fetchCount += 1;
        throw new Error("relay should not be called for known identity");
      },
      guestFollows,
      installation: async () => ({ kind: "none" }),
      liveNotifications: memoryNotifications(),
      network: async () => "offline",
      now: () => Date.parse("2026-09-11T00:00:00.000Z"),
      relayBaseUrl: "http://relay.test/",
    });
    const followed = await session.mutateFollow({
      channelId: "71092938",
      channelLogin: "alice",
      displayName: "Alice",
      platform: "twitch",
    });
    expect(followed).toMatchObject({
      kind: "followed",
      follow: {
        channelId: "71092938",
        channelLogin: "alice",
        displayName: "Alice",
        platform: "twitch",
      },
    });
    expect(fetchCount).toBe(0);
    expect(await session.listMembership()).toHaveLength(1);
  });

  it("adds and removes Guest Follows without account mutation success", async () => {
    const guestFollows = memoryGuestFollows();
    const urls: string[] = [];
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify(
            gqlUser({
              id: "71092938",
              login: "alice",
              stream: null,
            }),
          ),
        );
      },
      guestFollows,
      installation: async () => ({
        credential: "install",
        kind: "ready",
      }),
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      now: () => Date.parse("2026-09-11T00:00:00.000Z"),
      relayBaseUrl: "http://relay.test/",
    });
    const followed = await session.mutateFollow({
      channelLogin: "Alice",
      platform: "twitch",
    });
    expect(followed.kind).toBe("followed");
    expect(urls.some((url) => url.includes("gql.twitch.tv"))).toBe(true);
    const membership = await session.listMembership();
    expect(membership).toHaveLength(1);
    const removed = await session.mutateFollow({
      channelId: membership[0]?.channelId,
      platform: "twitch",
    });
    expect(removed).toEqual({
      channelId: "71092938",
      kind: "unfollowed",
      platform: "twitch",
    });
    expect(await session.listMembership()).toEqual([]);
  });

  it("hydrates live Guest Follows through followed-content identity reads", async () => {
    const follow = guestFollow({
      channelId: "71092938",
      channelLogin: "alice",
      platform: "twitch",
    });
    const urls: string[] = [];
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        return new Response(
          JSON.stringify(
            gqlUser({
              id: "71092938",
              login: "alice",
              stream: {
                broadcaster: {
                  displayName: "alice",
                  id: "71092938",
                  login: "alice",
                  profileImageURL: "https://example.test/avatar.png",
                  roles: { isPartner: false },
                },
                createdAt: "2026-09-11T00:00:00.000Z",
                freeformTags: [],
                game: {
                  displayName: "Just Chatting",
                  id: "509658",
                  name: "Just Chatting",
                },
                id: "stream-1",
                previewImageURL: "https://example.test/thumb.png",
                title: "live",
                viewersCount: 12,
              },
            }),
          ),
        );
      },
      guestFollows: memoryGuestFollows([follow]),
      installation: async () => ({
        credential: "install",
        kind: "ready",
      }),
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    const live = await session.hydrateLive();
    expect(urls.some((url) => url.includes("gql.twitch.tv"))).toBe(true);
    expect(urls.some((url) => url.includes("followed-content/streams"))).toBe(
      false,
    );
    expect(urls.some((url) => url.includes("getFollowedStreams"))).toBe(false);
    expect(urls.some((url) => url.includes("top-streams"))).toBe(false);
    expect(live.twitch.items[0]?.channelId).toBe("71092938");
    expect(await session.listMembership()).toEqual([follow]);
  });

  it("rejects unresolved Guest Follows instead of inventing account success", async () => {
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async () => new Response(JSON.stringify({ data: { user: null } })),
      guestFollows: memoryGuestFollows(),
      installation: async () => ({
        credential: "install",
        kind: "ready",
      }),
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    await expect(
      session.mutateFollow({ channelLogin: "missing", platform: "twitch" }),
    ).resolves.toEqual({ kind: "rejected", reason: "unresolved-channel" });
  });

  it("unions Twitch and Kick account follows into listMembership without breaking guest", async () => {
    const guest = guestFollow({
      channelId: "71092938",
      channelLogin: "alice",
      platform: "twitch",
    });
    const twitchAccount = guestFollow({
      channelId: "999",
      channelLogin: "bob",
      displayName: "Bob",
      platform: "twitch",
    });
    const kickAccount = guestFollow({
      channelId: "411439",
      channelLogin: "summit1g",
      displayName: "Summit1G",
      platform: "kick",
    });
    const guestStore = memoryGuestFollows([guest]);
    const session = createFollowingRuntime({
      accountFollows: [
        {
          read: async () => ({
            kind: "available" as const,
            follows: [twitchAccount],
          }),
        },
        {
          read: async () => ({
            kind: "available" as const,
            follows: [kickAccount],
          }),
        },
      ],
      cache: memoryCache(),
      fetch: async () =>
        new Response(
          JSON.stringify(
            envelope({ channels: [], missing: [], platform: "twitch" }),
          ),
        ),
      guestFollows: guestStore,
      installation: async () => ({
        credential: "install",
        kind: "ready",
      }),
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    const membership = await session.listMembership();
    expect(membership.map((row) => row.channelId).sort()).toEqual([
      "411439",
      "71092938",
      "999",
    ]);
    expect(await session.listGuestMembership()).toEqual([guest]);
    await expect(
      session.removeGuestFollow({ platform: "twitch", channelId: "999" }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "guest-only-scope",
    });
    expect(await guestStore.list()).toEqual([guest]);
    await expect(
      session.removeGuestFollow({
        platform: "twitch",
        channelId: guest.channelId,
      }),
    ).resolves.toEqual({
      kind: "unfollowed",
      platform: "twitch",
      channelId: guest.channelId,
    });
    expect(await session.listGuestMembership()).toEqual([]);
    expect(
      (await session.listMembership()).map((row) => row.channelId).sort(),
    ).toEqual(["411439", "999"]);
  });

  it("keeps guest membership when account follow sources are unavailable", async () => {
    const guest = guestFollow({
      channelId: "71092938",
      channelLogin: "alice",
      platform: "twitch",
    });
    const session = createFollowingRuntime({
      accountFollows: [
        {
          read: async () => ({
            kind: "unavailable" as const,
            reason: "twitch-client-id-missing",
          }),
        },
      ],
      cache: memoryCache(),
      fetch: async () =>
        new Response(
          JSON.stringify(
            envelope({ channels: [], missing: [], platform: "twitch" }),
          ),
        ),
      guestFollows: memoryGuestFollows([guest]),
      installation: async () => ({
        credential: "install",
        kind: "ready",
      }),
      liveNotifications: memoryNotifications(),
      network: async () => "online",
      relayBaseUrl: "http://relay.test/",
    });
    expect(await session.listMembership()).toEqual([guest]);
  });
});
