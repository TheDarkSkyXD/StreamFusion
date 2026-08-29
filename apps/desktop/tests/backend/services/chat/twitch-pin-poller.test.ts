import { afterEach, describe, expect, it, vi } from "vitest";

import { twitchChatService } from "@backend/services/chat/twitch-chat";
import { __resetTwitchPinPollers, toNormalized } from "@backend/services/chat/twitch-pin-poller";

// Guards: Twitch `PinnedChatMessage.id` (the pin record's id) is NOT the same as `pinnedMessage.id` (the chat message's id). The normalized payload's `messageId` must come from `pinnedMessage.id` so the banner can thread back to the right chat row. First test pins fixture ids from production GQL to keep these distinct on every diff.
// Guards: `PinnedChatMessage` includes Twitch's live pin timing fields (`startsAt`, `endsAt`) so timed pins can render the native duration progress bar.
// Guards: pin payloads with `pinnedMessage: null` (chat message deleted while pin record is still active) must still produce a valid banner using the pin record's id and an empty content array.
// Guards: Twitch pinnedBy and sender ids flow into the normalized payload so pinned banner usernames can open the user popout.
// Guards: Twitch pinned-message emote fragments stay rich so pinned emotes render as images instead of plain text.

afterEach(() => {
  __resetTwitchPinPollers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "electronAPI", { configurable: true, value: undefined });
});

describe("transport", () => {
  it("uses the Electron chat bridge when available so renderer fetch does not log net::ERR failures", async () => {
    const bridgedPin = {
      id: "pin-bridge",
      type: "MOD",
      updatedAt: "2026-05-18T01:12:12Z",
      startsAt: "2026-05-18T01:10:00Z",
      endsAt: "2026-05-18T01:20:00Z",
      pinnedBy: null,
      pinnedMessage: {
        id: "msg-bridge",
        sentAt: null,
        sender: {
          login: "alice",
          displayName: "Alice",
          chatColor: null,
          displayBadges: null,
        },
        content: { text: "hello", fragments: [{ text: "hello", content: null }] },
      },
    };
    const getTwitchPinnedMessage = vi.fn().mockResolvedValue({ success: true, data: bridgedPin });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { getTwitchPinnedMessage } },
    });

    const { startTwitchPinPolling } = await import("@backend/services/chat/twitch-pin-poller");
    startTwitchPinPolling("FitzBro");
    await vi.waitFor(() => expect(getTwitchPinnedMessage).toHaveBeenCalled());

    expect(getTwitchPinnedMessage).toHaveBeenCalledWith({ channel: "fitzbro" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to direct GQL when the Electron bridge returns a pin without timing fields", async () => {
    const bridgedPin = {
      id: "pin-stale-bridge",
      type: "MOD",
      updatedAt: "2026-06-29T05:13:42Z",
      pinnedBy: null,
      pinnedMessage: {
        id: "msg-stale-bridge",
        sentAt: null,
        sender: {
          login: "alice",
          displayName: "Alice",
          chatColor: null,
          displayBadges: null,
        },
        content: { text: "timed", fragments: [{ text: "timed", content: null }] },
      },
    };
    const timedPin = {
      ...bridgedPin,
      startsAt: "2026-06-29T05:13:42Z",
      endsAt: "2026-06-29T05:28:42Z",
    };
    const getTwitchPinnedMessage = vi.fn().mockResolvedValue({ success: true, data: bridgedPin });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          channel: {
            pinnedChatMessages: {
              edges: [{ node: timedPin }],
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { getTwitchPinnedMessage } },
    });
    const emitSpy = vi.spyOn(twitchChatService, "emit");

    const { startTwitchPinPolling } = await import("@backend/services/chat/twitch-pin-poller");
    startTwitchPinPolling("DarkSkyFullOfStars");

    await vi.waitFor(() => {
      expect(emitSpy).toHaveBeenCalledWith(
        "pinnedMessage",
        expect.objectContaining({
          messageId: "msg-stale-bridge",
          pinnedAt: "2026-06-29T05:13:42Z",
          expiresAt: "2026-06-29T05:28:42Z",
        }),
      );
    });
    expect(getTwitchPinnedMessage).toHaveBeenCalledWith({ channel: "darkskyfullofstars" });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("re-emits the same pinned message when its duration fields change", async () => {
    vi.useFakeTimers();
    const untimedPin = {
      id: "pin-duration-change",
      type: "MOD",
      updatedAt: "2026-06-29T05:13:42Z",
      startsAt: null,
      endsAt: null,
      pinnedBy: null,
      pinnedMessage: {
        id: "msg-duration-change",
        sentAt: null,
        sender: {
          login: "alice",
          displayName: "Alice",
          chatColor: null,
          displayBadges: null,
        },
        content: { text: "timed", fragments: [{ text: "timed", content: null }] },
      },
    };
    const timedPin = {
      ...untimedPin,
      startsAt: "2026-06-29T05:13:42Z",
      endsAt: "2026-06-29T05:28:42Z",
    };
    const getTwitchPinnedMessage = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: untimedPin })
      .mockResolvedValue({ success: true, data: timedPin });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { getTwitchPinnedMessage } },
    });
    const emitSpy = vi.spyOn(twitchChatService, "emit");
    const pinEvents = () => emitSpy.mock.calls.filter(([event]) => event === "pinnedMessage");

    const { startTwitchPinPolling } = await import("@backend/services/chat/twitch-pin-poller");
    startTwitchPinPolling("FitzBro");

    await vi.waitFor(() => expect(pinEvents()).toHaveLength(1));
    expect(pinEvents()[0]?.[1]).toMatchObject({ messageId: "msg-duration-change", expiresAt: null });

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(pinEvents()).toHaveLength(2));
    expect(pinEvents()[1]?.[1]).toMatchObject({
      messageId: "msg-duration-change",
      pinnedAt: "2026-06-29T05:13:42Z",
      expiresAt: "2026-06-29T05:28:42Z",
    });
  });
});

describe("toNormalized", () => {
  it("builds a complete payload from a live fitzbro-shaped pin including displayBadges", () => {
    // Verbatim shape captured from gql.twitch.tv on 2026-05-18 against
    // channel `fitzbro` — pinnedBy and sender both carry a `displayBadges`
    // array from User.displayBadges(channelLogin: $login). The full set
    // (Broadcaster / 2.5-Year Subscriber / Verified) is what twitch.tv
    // renders inline in its own pin card header.
    const normalized = toNormalized({
      id: "8fee27eb-c167-4fe0-bede-2ae035e48190",
      type: "MOD",
      updatedAt: "2026-05-18T01:12:12Z",
      startsAt: "2026-05-18T01:10:00Z",
      endsAt: "2026-05-18T01:20:00Z",
      pinnedBy: {
        id: "1001",
        login: "fitzbro",
        displayName: "FitzBro",
        chatColor: "#008000",
        displayBadges: [
          {
            setID: "broadcaster",
            version: "1",
            title: "Broadcaster",
            imageURL: "https://static-cdn.jtvnw.net/badges/v1/5527c58c/1",
          },
          {
            setID: "subscriber",
            version: "3030",
            title: "2.5-Year Subscriber",
            imageURL: "https://static-cdn.jtvnw.net/badges/v1/6e1df200/1",
          },
        ],
      },
      pinnedMessage: {
        id: "37be039a-0aac-42ab-b783-2d63dffcbcf6",
        sentAt: "2026-05-18T01:11:00.000Z",
        sender: {
          id: "1001",
          login: "fitzbro",
          displayName: "FitzBro",
          chatColor: "#008000",
          displayBadges: null,
        },
        content: {
          text: "https://www.youtube.com/@CoHBro",
          fragments: [{ text: "https://www.youtube.com/@CoHBro", content: null }],
        },
      },
    });

    expect(normalized.messageId).toBe("37be039a-0aac-42ab-b783-2d63dffcbcf6");
    expect(normalized.pinnedAt).toBe("2026-05-18T01:10:00Z");
    expect(normalized.expiresAt).toBe("2026-05-18T01:20:00Z");
    expect(normalized.author.userId).toBe("1001");
    expect(normalized.pinnedBy?.userId).toBe("1001");
    expect(normalized.pinnedBy?.username).toBe("fitzbro");
    expect(normalized.pinnedBy?.displayName).toBe("FitzBro");
    expect(normalized.pinnedBy?.badges).toEqual([
      {
        setId: "broadcaster",
        version: "1",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/5527c58c/1",
        title: "Broadcaster",
      },
      {
        setId: "subscriber",
        version: "3030",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/6e1df200/1",
        title: "2.5-Year Subscriber",
      },
    ]);
  });

  it("maps a non-broadcaster mod's badges (Moderator + Subscriber) correctly", () => {
    // Real-world case: a moderator (not the broadcaster) pins a message.
    // displayBadges returns their actual chat badges, which we map 1:1.
    const normalized = toNormalized({
      id: "pin-mod",
      type: "MOD",
      updatedAt: "2026-05-18T04:42:37Z",
      startsAt: "2026-05-18T04:40:00Z",
      endsAt: "2026-05-18T04:50:00Z",
      pinnedBy: {
        login: "modlogin",
        displayName: "ModName",
        chatColor: "#FF6F61",
        displayBadges: [
          {
            setID: "moderator",
            version: "1",
            title: "Moderator",
            imageURL: "https://static-cdn.jtvnw.net/badges/v1/3267646d/1",
          },
          {
            setID: "subscriber",
            version: "12",
            title: "1-Year Subscriber",
            imageURL: "https://static-cdn.jtvnw.net/badges/v1/sub-12/1",
          },
        ],
      },
      pinnedMessage: {
        id: "msg-mod",
        sentAt: null,
        sender: { login: "alice", displayName: "Alice", chatColor: "#FF7F50", displayBadges: null },
        content: { text: "hi", fragments: [{ text: "hi", content: null }] },
      },
    });

    expect(normalized.pinnedBy?.badges).toHaveLength(2);
    expect(normalized.pinnedBy!.badges[0].setId).toBe("moderator");
    expect(normalized.pinnedBy!.badges[1].setId).toBe("subscriber");
  });

  it("converts plain-text URLs into link fragments so the banner renders <a> tags", () => {
    // Twitch's chat-message GQL fragments come back as plain text — twitch.tv
    // parses URLs at render time. The poller mirrors that so the banner's
    // shared <PinnedFragment> can render a real link, not inert text.
    const normalized = toNormalized({
      id: "pin-link",
      type: "MOD",
      updatedAt: "2026-05-18T04:42:37Z",
      startsAt: "2026-05-18T04:40:00Z",
      endsAt: "2026-05-18T04:50:00Z",
      pinnedBy: {
        login: "fitzbro",
        displayName: "FitzBro",
        chatColor: "#008000",
        displayBadges: null,
      },
      pinnedMessage: {
        id: "msg-link",
        sentAt: null,
        sender: {
          login: "fitzbro",
          displayName: "FitzBro",
          chatColor: "#008000",
          displayBadges: null,
        },
        content: {
          text: "check this https://example.com/foo",
          fragments: [{ text: "check this https://example.com/foo", content: null }],
        },
      },
    });

    expect(normalized.content).toEqual([
      { type: "text", content: "check this " },
      { type: "link", url: "https://example.com/foo", text: "https://example.com/foo" },
    ]);
  });

  it("returns an empty badges array when displayBadges is null", () => {
    const normalized = toNormalized({
      id: "pin-nobadges",
      type: "MOD",
      updatedAt: "2026-05-18T04:42:37Z",
      startsAt: "2026-05-18T04:40:00Z",
      endsAt: "2026-05-18T04:50:00Z",
      pinnedBy: {
        login: "nobadges",
        displayName: "NoBadges",
        chatColor: "#FF6F61",
        displayBadges: null,
      },
      pinnedMessage: {
        id: "msg-nb",
        sentAt: null,
        sender: {
          login: "nobadges",
          displayName: "NoBadges",
          chatColor: "#FF6F61",
          displayBadges: null,
        },
        content: { text: "hi", fragments: [{ text: "hi", content: null }] },
      },
    });
    expect(normalized.pinnedBy?.badges).toEqual([]);
  });

  it("falls back to pinnedBy-as-author with empty content when pinnedMessage is null", () => {
    // Defensive case: a pin record exists but the nested message is missing
    // (e.g. the chat message was deleted server-side while the pin record
    // is still active). The banner should still render the "Pinned by X"
    // header.
    const normalized = toNormalized({
      id: "pin-1",
      type: "MOD",
      updatedAt: "2026-05-17T01:00:00Z",
      startsAt: "2026-05-17T00:55:00Z",
      endsAt: "2026-05-17T01:05:00Z",
      pinnedBy: {
        login: "fitzbro",
        displayName: "FitzBro",
        chatColor: "#008000",
        displayBadges: null,
      },
      pinnedMessage: null,
    });

    expect(normalized.platform).toBe("twitch");
    expect(normalized.messageId).toBe("pin-1");
    expect(normalized.content).toEqual([]);
    expect(normalized.author).toEqual({
      username: "fitzbro",
      displayName: "FitzBro",
      color: "#008000",
      badges: [],
    });
    expect(normalized.pinnedBy).toEqual({
      username: "fitzbro",
      displayName: "FitzBro",
      color: "#008000",
      badges: [],
    });
  });

  it("falls back to an unknown author when both pinnedMessage and pinnedBy are null", () => {
    const normalized = toNormalized({
      id: "pin-x",
      type: null,
      updatedAt: null,
      startsAt: null,
      endsAt: null,
      pinnedBy: null,
      pinnedMessage: null,
    });

    expect(normalized.author.username).toBe("unknown");
    expect(normalized.pinnedBy).toBeNull();
    // pinnedAt must still be a valid ISO string so banner timestamp logic works.
    expect(() => new Date(normalized.pinnedAt).toISOString()).not.toThrow();
  });

  it("prefers content.text over fragment-concatenation when both are present", () => {
    const normalized = toNormalized({
      id: "pin-2",
      type: "MOD",
      updatedAt: "2026-05-17T12:00:00Z",
      startsAt: "2026-05-17T11:55:00Z",
      endsAt: "2026-05-17T12:05:00Z",
      pinnedBy: {
        login: "modlogin",
        displayName: "ModName",
        chatColor: "#FF6F61",
        displayBadges: null,
      },
      pinnedMessage: {
        id: "chat-2",
        sentAt: null,
        sender: { login: "alice", displayName: "Alice", chatColor: null, displayBadges: null },
        content: {
          text: "authoritative text",
          // Fragments would join to a different string if used as the source.
          fragments: [{ text: "DIFFERENT", content: null }],
        },
      },
    });
    expect(normalized.content).toEqual([{ type: "text", content: "authoritative text" }]);
  });

  it("preserves Twitch emote fragments in pinned-message content", () => {
    const normalized = toNormalized({
      id: "pin-emote",
      type: "MOD",
      updatedAt: "2026-05-17T12:00:00Z",
      startsAt: "2026-05-17T11:55:00Z",
      endsAt: "2026-05-17T12:05:00Z",
      pinnedBy: null,
      pinnedMessage: {
        id: "chat-emote",
        sentAt: null,
        sender: { login: "alice", displayName: "Alice", chatColor: null, displayBadges: null },
        content: {
          text: "hello Kappa https://example.com",
          fragments: [
            { text: "hello ", content: null },
            {
              text: "Kappa",
              content: {
                __typename: "Emote",
                id: "25",
                token: "Kappa",
                assetType: "STATIC",
              },
            },
            { text: " https://example.com", content: null },
          ],
        },
      },
    });

    expect(normalized.content).toEqual([
      { type: "text", content: "hello " },
      {
        type: "emote",
        id: "25",
        name: "Kappa",
        url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0",
        isAnimated: false,
        isZeroWidth: false,
      },
      { type: "text", content: " " },
      { type: "link", url: "https://example.com", text: "https://example.com" },
    ]);
  });

  it("falls back to fragment-concatenation when content.text is empty/missing", () => {
    const normalized = toNormalized({
      id: "pin-3",
      type: "MOD",
      updatedAt: "2026-05-17T12:00:00Z",
      startsAt: "2026-05-17T11:55:00Z",
      endsAt: "2026-05-17T12:05:00Z",
      pinnedBy: null,
      pinnedMessage: {
        id: "chat-3",
        sentAt: null,
        sender: {
          login: "alice",
          displayName: "Alice",
          chatColor: "#FF7F50",
          displayBadges: null,
        },
        content: {
          text: "",
          fragments: [
            { text: "hello ", content: null },
            { text: "world", content: null },
          ],
        },
      },
    });
    expect(normalized.content).toEqual([{ type: "text", content: "hello world" }]);
  });

  it("substitutes a default color when sender.chatColor is null", () => {
    const normalized = toNormalized({
      id: "pin-4",
      type: "MOD",
      updatedAt: "2026-05-17T12:00:00Z",
      startsAt: "2026-05-17T11:55:00Z",
      endsAt: "2026-05-17T12:05:00Z",
      pinnedBy: null,
      pinnedMessage: {
        id: "chat-4",
        sentAt: null,
        sender: { login: "alice", displayName: "Alice", chatColor: null, displayBadges: null },
        content: { text: "hi", fragments: null },
      },
    });
    // Twitch default purple — picked so the banner always has a usable color.
    expect(normalized.author.color).toBe("#9146FF");
  });
});
