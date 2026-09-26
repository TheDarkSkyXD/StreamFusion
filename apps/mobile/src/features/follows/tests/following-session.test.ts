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
      guestFollows: memoryGuestFollows([guest]),
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
