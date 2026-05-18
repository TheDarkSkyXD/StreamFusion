import { afterEach, describe, expect, it } from "vitest";

import { __resetTwitchPinPollers, toNormalized } from "@/backend/services/chat/twitch-pin-poller";

afterEach(() => {
  __resetTwitchPinPollers();
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
      pinnedBy: {
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
    expect(normalized.pinnedBy?.username).toBe("fitzbro");
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
      pinnedBy: {
        login: "fitzbro",
        displayName: "FitzBro",
        chatColor: "#008000",
        displayBadges: null,
      },
      pinnedMessage: {
        id: "msg-link",
        sentAt: null,
        sender: { login: "fitzbro", displayName: "FitzBro", chatColor: "#008000", displayBadges: null },
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
    expect(normalized.pinnedBy).toEqual({ username: "fitzbro", color: "#008000", badges: [] });
  });

  it("falls back to an unknown author when both pinnedMessage and pinnedBy are null", () => {
    const normalized = toNormalized({
      id: "pin-x",
      type: null,
      updatedAt: null,
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

  it("falls back to fragment-concatenation when content.text is empty/missing", () => {
    const normalized = toNormalized({
      id: "pin-3",
      type: "MOD",
      updatedAt: "2026-05-17T12:00:00Z",
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
