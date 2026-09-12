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
import {
  followedChannel,
  followedStream,
  guestFollow,
} from "../domain/following-fixtures";

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

function envelope(body: object) {
  return createRelaySuccessEnvelope({
    body: JSON.parse(JSON.stringify(body)),
    requestId: "req-1",
  });
}

describe("createFollowingRuntime", () => {
  it("adds and removes Guest Follows without account mutation success", async () => {
    const guestFollows = memoryGuestFollows();
    const urls: string[] = [];
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify(
            envelope({
              channels: [
                followedChannel({
                  id: "71092938",
                  platform: "twitch",
                  username: "alice",
                }),
              ],
              missing: [],
              platform: "twitch",
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
    expect(urls.some((url) => url.includes("followed-content/channels"))).toBe(
      true,
    );
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
        const stream = followedStream({
          channelId: "71092938",
          channelName: "alice",
          platform: "twitch",
        });
        return new Response(
          JSON.stringify(
            envelope({
              missing: [{ kind: "id", value: "offline-1" }],
              platform: "twitch",
              streams: [stream],
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
    expect(urls.some((url) => url.includes("followed-content/streams"))).toBe(
      true,
    );
    expect(urls.some((url) => url.includes("getFollowedStreams"))).toBe(false);
    expect(urls.some((url) => url.includes("top-streams"))).toBe(false);
    expect(live.twitch.items[0]?.channelId).toBe("71092938");
    expect(await session.listMembership()).toEqual([follow]);
  });

  it("rejects unresolved Guest Follows instead of inventing account success", async () => {
    const session = createFollowingRuntime({
      cache: memoryCache(),
      fetch: async () =>
        new Response(
          JSON.stringify(
            envelope({ channels: [], missing: [], platform: "twitch" }),
          ),
        ),
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
});
