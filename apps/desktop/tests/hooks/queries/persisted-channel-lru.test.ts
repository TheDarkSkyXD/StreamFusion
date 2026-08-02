import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPersistedChannelEntries,
  getPersistedChannelMetadata,
  hydratePersistedChannelLru,
  PERSISTED_CHANNEL_LRU_LIMITS,
  resetPersistedChannelLruForTests,
  savePersistedChannelMetadata,
} from "@/hooks/queries/persisted-channel-lru";
import { fixtures, installElectronAPIMock } from "../../test-utils";

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
  resetPersistedChannelLruForTests();
});

// Guards: persisted channel metadata is exact by normalized platform+username and keeps Kick's chatroom ID available after cold hydration.
// Guards: stale, future-dated, incomplete Kick, oversized, and excess entries cannot make the startup cache unbounded or poison chat routing.
describe("persisted channel metadata LRU", () => {
  it("hydrates exact platform and username entries with Kick chatroom metadata intact", async () => {
    const kick = fixtures.channel({
      id: "kick-channel",
      platform: "kick",
      username: "XQC",
      chatroomId: 12345,
    });
    const twitch = fixtures.channel({
      id: "twitch-channel",
      platform: "twitch",
      username: "xqc",
    });
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        { platform: "kick", username: "xqc", savedAt: Date.now(), data: kick },
        { platform: "twitch", username: "xqc", savedAt: Date.now() - 1, data: twitch },
      ],
    }));

    await hydratePersistedChannelLru();

    expect(getPersistedChannelMetadata("  XqC ", "kick")).toMatchObject({
      id: "kick-channel",
      chatroomId: 12345,
    });
    expect(getPersistedChannelMetadata("xqc", "twitch")?.id).toBe("twitch-channel");
    expect(getPersistedChannelMetadata("other", "kick")).toBeUndefined();
    expect(getPersistedChannelMetadata("other", "twitch")).toBeUndefined();
  });

  it("rejects expired, future-dated, and incomplete Kick entries", async () => {
    const now = Date.now();
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "twitch",
          username: "stale",
          savedAt: now - PERSISTED_CHANNEL_LRU_LIMITS.maxAgeMs - 1,
          data: fixtures.channel({ platform: "twitch", username: "stale" }),
        },
        {
          platform: "twitch",
          username: "future",
          savedAt: now + 60_000,
          data: fixtures.channel({ platform: "twitch", username: "future" }),
        },
        {
          platform: "kick",
          username: "missing-room",
          savedAt: now,
          data: fixtures.channel({
            platform: "kick",
            username: "missing-room",
            chatroomId: undefined,
          }),
        },
      ],
    }));

    await hydratePersistedChannelLru();

    expect(getPersistedChannelEntries()).toEqual([]);
  });

  it("keeps only the newest bounded entries when hydrating", async () => {
    const now = Date.now();
    const storedEntries = Array.from(
      { length: PERSISTED_CHANNEL_LRU_LIMITS.maxEntries + 5 },
      (_, index) => {
        const username = `channel-${index}`;
        return {
          platform: "twitch" as const,
          username,
          savedAt: now - index,
          data: fixtures.channel({ id: username, platform: "twitch", username }),
        };
      }
    );
    api.store.get = vi.fn(async () => ({ version: 1, entries: storedEntries }));

    await hydratePersistedChannelLru();

    expect(getPersistedChannelEntries()).toHaveLength(PERSISTED_CHANNEL_LRU_LIMITS.maxEntries);
    expect(getPersistedChannelMetadata("channel-0", "twitch")).toBeDefined();
    expect(
      getPersistedChannelMetadata(
        `channel-${PERSISTED_CHANNEL_LRU_LIMITS.maxEntries + 4}`,
        "twitch"
      )
    ).toBeUndefined();
  });

  it("persists a byte-bounded payload and ignores unusable saves", async () => {
    api.store.get = vi.fn(async () => null);
    api.store.set = vi.fn(async () => undefined);

    await savePersistedChannelMetadata(
      fixtures.channel({ platform: "kick", username: "missing-room", chatroomId: undefined })
    );
    expect(api.store.set).not.toHaveBeenCalled();

    for (let index = 0; index < 10; index += 1) {
      await savePersistedChannelMetadata(
        fixtures.channel({
          id: `large-${index}`,
          platform: "twitch",
          username: `large-${index}`,
          bio: "x".repeat(80_000),
        })
      );
    }

    const lastPayload = vi.mocked(api.store.set).mock.calls.at(-1)?.[1];
    expect(new TextEncoder().encode(JSON.stringify(lastPayload)).byteLength).toBeLessThanOrEqual(
      PERSISTED_CHANNEL_LRU_LIMITS.maxBytes
    );
    expect(getPersistedChannelEntries().length).toBeLessThan(10);
  });
});
