import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/shared/chat-types";
import { buildChannelKey, useChatStore } from "@/store/chat-store";
import {
  getPersistedChatHistory,
  hydratePersistedChatHistory,
  PERSISTED_CHAT_HISTORY_LIMITS,
  primePersistedChatHistoryIntent,
  primePersistedChatHistoryIntentAsync,
  resetPersistedChatHistoryForTests,
  savePersistedChatHistory,
} from "@/store/persisted-chat-history";
import { installElectronAPIMock } from "../test-utils";

function makeMessage(id: string, channel = "xqc"): ChatMessage {
  return {
    id,
    platform: "kick",
    type: "message",
    channel,
    userId: "user-1",
    username: "viewer",
    displayName: "Viewer",
    color: "#53fc18",
    badges: [],
    content: [{ type: "text", content: id }],
    rawContent: id,
    timestamp: new Date("2026-07-14T12:00:00.000Z"),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
    isHistorical: true,
  };
}

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
  resetPersistedChatHistoryForTests();
  useChatStore.getState().cleanupBatching();
  useChatStore.setState({ messagesByChannel: {}, usersByChannel: {}, pausedChannels: new Set() });
});

// Guards: cached history is restored only for the exact platform, normalized channel, and internal channel id, with timestamps revived as Dates.
describe("persisted chat history", () => {
  it("primes an immediate return before the asynchronous disk save completes", async () => {
    let resolveStored!: (value: null) => void;
    api.store.get = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveStored = resolve;
        })
    );
    api.store.set = vi.fn(async () => undefined);

    const save = savePersistedChatHistory("kick", "xqc", "411439", [makeMessage("just-seen")]);

    expect(
      primePersistedChatHistoryIntent({
        platform: "kick",
        normalizedChannel: "xqc",
        channelId: "411439",
        limit: 50,
      })
    ).toBe(true);
    expect(useChatStore.getState().messagesByChannel[buildChannelKey("kick", "xqc")]).toEqual([
      expect.objectContaining({ id: "just-seen", isHistorical: true }),
    ]);

    await vi.waitFor(() => expect(api.store.get).toHaveBeenCalledTimes(1));
    resolveStored(null);
    await save;
  });

  it("hydrates an exact Kick channel with Date timestamps", async () => {
    const message = makeMessage("cached-1");
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "xqc",
          channelId: "411439",
          savedAt: Date.now(),
          messages: [{ ...message, timestamp: message.timestamp.toISOString() }],
        },
      ],
    }));

    await hydratePersistedChatHistory();

    const restored = getPersistedChatHistory("kick", "  XQC ", "411439");
    expect(restored).toHaveLength(1);
    expect(restored?.[0].timestamp).toEqual(message.timestamp);
    expect(restored?.[0].timestamp).toBeInstanceOf(Date);
    expect(getPersistedChatHistory("kick", "xqc", "different-id")).toBeUndefined();
    expect(getPersistedChatHistory("twitch", "xqc", "411439")).toBeUndefined();
  });

  it("persists only the newest 50 normal, non-deleted historical rows", async () => {
    api.store.get = vi.fn(async () => null);
    api.store.set = vi.fn(async () => undefined);
    const messages = Array.from({ length: 55 }, (_, index) => makeMessage(`message-${index}`));
    messages.push({ ...makeMessage("system"), type: "system" });
    messages.push({ ...makeMessage("deleted"), isDeleted: true });

    await savePersistedChatHistory("kick", "xqc", "411439", messages);

    const payload = vi.mocked(api.store.set).mock.calls.at(-1)?.[1] as {
      entries: Array<{ messages: Array<{ id: string; type: string; isDeleted: boolean }> }>;
    };
    expect(payload.entries[0].messages).toHaveLength(50);
    expect(payload.entries[0].messages[0].id).toBe("message-5");
    expect(payload.entries[0].messages.every((message) => message.type === "message")).toBe(true);
    expect(payload.entries[0].messages.every((message) => !message.isDeleted)).toBe(true);
    expect(getPersistedChatHistory("kick", "xqc", "411439")).toHaveLength(50);
  });

  it("evicts the least-recent channel and keeps the payload byte-bounded", async () => {
    api.store.get = vi.fn(async () => null);
    api.store.set = vi.fn(async () => undefined);

    for (let index = 0; index < PERSISTED_CHAT_HISTORY_LIMITS.maxChannels + 1; index += 1) {
      const message = makeMessage(`message-${index}`, `channel-${index}`);
      message.rawContent = "x".repeat(120_000);
      message.content = [{ type: "text", content: message.rawContent }];
      await savePersistedChatHistory("kick", `channel-${index}`, `id-${index}`, [message]);
    }

    const payload = vi.mocked(api.store.set).mock.calls.at(-1)?.[1] as { entries: unknown[] };
    expect(payload.entries.length).toBeLessThanOrEqual(PERSISTED_CHAT_HISTORY_LIMITS.maxChannels);
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThanOrEqual(
      PERSISTED_CHAT_HISTORY_LIMITS.maxBytes
    );
    expect(getPersistedChatHistory("kick", "channel-0", "id-0")).toBeUndefined();
    expect(
      getPersistedChatHistory(
        "kick",
        `channel-${PERSISTED_CHAT_HISTORY_LIMITS.maxChannels}`,
        `id-${PERSISTED_CHAT_HISTORY_LIMITS.maxChannels}`
      )
    ).toHaveLength(1);
  });

  it("rejects expired entries and transient, deleted, or malformed stored rows", async () => {
    const valid = makeMessage("valid");
    const system = { ...makeMessage("system"), type: "system" as const };
    const deleted = { ...makeMessage("deleted"), isDeleted: true };
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "expired",
          channelId: "expired-id",
          savedAt: Date.now() - PERSISTED_CHAT_HISTORY_LIMITS.maxAgeMs - 1,
          messages: [{ ...valid, timestamp: valid.timestamp.toISOString() }],
        },
        {
          platform: "kick",
          channel: "xqc",
          channelId: "411439",
          savedAt: Date.now(),
          messages: [
            { ...valid, timestamp: valid.timestamp.toISOString() },
            { ...system, timestamp: system.timestamp.toISOString() },
            { ...deleted, timestamp: deleted.timestamp.toISOString() },
            { ...valid, id: "bad-date", timestamp: "not-a-date" },
          ],
        },
      ],
    }));

    await hydratePersistedChatHistory();

    expect(getPersistedChatHistory("kick", "expired", "expired-id")).toBeUndefined();
    expect(getPersistedChatHistory("kick", "xqc", "411439")?.map((message) => message.id)).toEqual([
      "valid",
    ]);
  });

  it("expires hydrated entries at read time and never writes them back", async () => {
    const savedAt = new Date("2026-07-14T12:00:00.000Z").getTime();
    const now = vi.spyOn(Date, "now").mockReturnValue(savedAt);
    const expired = makeMessage("expired-later", "old-channel");
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "old-channel",
          channelId: "old-id",
          savedAt,
          messages: [{ ...expired, timestamp: expired.timestamp.toISOString() }],
        },
      ],
    }));
    api.store.set = vi.fn(async () => undefined);

    await hydratePersistedChatHistory();
    now.mockReturnValue(savedAt + PERSISTED_CHAT_HISTORY_LIMITS.maxAgeMs + 1);

    expect(getPersistedChatHistory("kick", "old-channel", "old-id")).toBeUndefined();
    await savePersistedChatHistory("kick", "new-channel", "new-id", [
      makeMessage("current", "new-channel"),
    ]);

    const payload = vi.mocked(api.store.set).mock.calls.at(-1)?.[1] as {
      entries: Array<{ channelId: string }>;
    };
    expect(payload.entries.map((entry) => entry.channelId)).toEqual(["new-id"]);
    now.mockRestore();
  });

  it("retries hydration after a transient store IPC failure", async () => {
    const cached = makeMessage("cached-after-retry");
    api.store.get = vi
      .fn()
      .mockRejectedValueOnce(new Error("store IPC unavailable during startup"))
      .mockResolvedValueOnce({
        version: 1,
        entries: [
          {
            platform: "kick",
            channel: "xqc",
            channelId: "411439",
            savedAt: Date.now(),
            messages: [{ ...cached, timestamp: cached.timestamp.toISOString() }],
          },
        ],
      });

    await hydratePersistedChatHistory();
    await hydratePersistedChatHistory();

    expect(api.store.get).toHaveBeenCalledTimes(2);
    expect(getPersistedChatHistory("kick", "xqc", "411439")?.map((message) => message.id)).toEqual([
      "cached-after-retry",
    ]);
  });

  it("synchronously primes the exact channel bucket after cache bootstrap", async () => {
    const cached = makeMessage("intent-cached");
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "xqc",
          channelId: "411439",
          savedAt: Date.now(),
          messages: [{ ...cached, timestamp: cached.timestamp.toISOString() }],
        },
      ],
    }));
    await hydratePersistedChatHistory();

    const primed = primePersistedChatHistoryIntent({
      platform: "kick",
      normalizedChannel: "xqc",
      channelId: "411439",
      limit: 1,
    });

    expect(primed).toBe(true);
    expect(useChatStore.getState().messagesByChannel[buildChannelKey("kick", "xqc")]).toEqual([
      expect.objectContaining({ id: "intent-cached", isHistorical: true }),
    ]);
  });

  it("does not prime history for a wrong or missing exact channel id", async () => {
    const cached = makeMessage("identity-guarded");
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "xqc",
          channelId: "411439",
          savedAt: Date.now(),
          messages: [{ ...cached, timestamp: cached.timestamp.toISOString() }],
        },
      ],
    }));
    await hydratePersistedChatHistory();

    expect(
      primePersistedChatHistoryIntent({
        platform: "kick",
        normalizedChannel: "xqc",
        channelId: "wrong-id",
        limit: 50,
      })
    ).toBe(false);
    expect(
      primePersistedChatHistoryIntent({
        platform: "kick",
        normalizedChannel: "xqc",
        channelId: "",
        limit: 50,
      })
    ).toBe(false);
    expect(useChatStore.getState().messagesByChannel).toEqual({});
  });

  it("retries one transient hydration failure before asynchronously priming intent", async () => {
    const cached = makeMessage("intent-after-retry");
    api.store.get = vi
      .fn()
      .mockRejectedValueOnce(new Error("cold-start IPC unavailable"))
      .mockResolvedValueOnce({
        version: 1,
        entries: [
          {
            platform: "kick",
            channel: "xqc",
            channelId: "411439",
            savedAt: Date.now(),
            messages: [{ ...cached, timestamp: cached.timestamp.toISOString() }],
          },
        ],
      });

    await expect(
      primePersistedChatHistoryIntentAsync({
        platform: "kick",
        normalizedChannel: "xqc",
        channelId: "411439",
        limit: 50,
      })
    ).resolves.toBe(true);

    expect(api.store.get).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().messagesByChannel[buildChannelKey("kick", "xqc")]).toEqual([
      expect.objectContaining({ id: "intent-after-retry", isHistorical: true }),
    ]);
  });

  it("keeps an asynchronously primed wrong exact id as a no-op", async () => {
    const cached = makeMessage("exact-only");
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "xqc",
          channelId: "411439",
          savedAt: Date.now(),
          messages: [{ ...cached, timestamp: cached.timestamp.toISOString() }],
        },
      ],
    }));

    await expect(
      primePersistedChatHistoryIntentAsync({
        platform: "kick",
        normalizedChannel: "xqc",
        channelId: "not-411439",
        limit: 50,
      })
    ).resolves.toBe(false);

    expect(useChatStore.getState().messagesByChannel).toEqual({});
  });

  it.each([
    ["16 minutes", 16 * 60 * 1000],
    ["6 hours", 6 * 60 * 60 * 1000],
  ])("still primes cached history saved %s ago", async (_label, ageMs) => {
    const cached = makeMessage(`retained-${ageMs}`);
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "xqc",
          channelId: "411439",
          savedAt: Date.now() - ageMs,
          messages: [{ ...cached, timestamp: cached.timestamp.toISOString() }],
        },
      ],
    }));
    await hydratePersistedChatHistory();

    expect(
      primePersistedChatHistoryIntent({
        platform: "kick",
        normalizedChannel: "xqc",
        channelId: "411439",
        limit: 50,
      })
    ).toBe(true);
    expect(useChatStore.getState().messagesByChannel[buildChannelKey("kick", "xqc")]).toEqual([
      expect.objectContaining({ id: `retained-${ageMs}`, isHistorical: true }),
    ]);
  });

  it("rejects and prunes history older than 24 hours", async () => {
    const expired = makeMessage("older-than-one-day", "old-channel");
    api.store.get = vi.fn(async () => ({
      version: 1,
      entries: [
        {
          platform: "kick",
          channel: "old-channel",
          channelId: "old-id",
          savedAt: Date.now() - 24 * 60 * 60 * 1000 - 1,
          messages: [{ ...expired, timestamp: expired.timestamp.toISOString() }],
        },
      ],
    }));
    api.store.set = vi.fn(async () => undefined);

    await hydratePersistedChatHistory();
    expect(getPersistedChatHistory("kick", "old-channel", "old-id")).toBeUndefined();
    await savePersistedChatHistory("kick", "current", "current-id", [
      makeMessage("current", "current"),
    ]);

    const payload = vi.mocked(api.store.set).mock.calls.at(-1)?.[1] as {
      entries: Array<{ channelId: string }>;
    };
    expect(payload.entries.map((entry) => entry.channelId)).toEqual(["current-id"]);
  });
});
