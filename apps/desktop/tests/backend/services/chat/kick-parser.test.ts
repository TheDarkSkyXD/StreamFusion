import { describe, expect, it, vi } from "vitest";

import {
  type KickBadge,
  type KickChatClearedEvent,
  type KickChatMessageEvent,
  type KickGiftedSubEvent,
  type KickHostRaidEvent,
  type KickMessageDeletedEvent,
  type KickSubscriptionEvent,
  type KickUserBannedEvent,
  parseKickBadges,
  parseKickChatCleared,
  parseKickChatMessage,
  parseKickGiftedSub,
  parseKickHostRaid,
  parseKickMessageContent,
  parseKickMessageDeleted,
  parseKickSubscription,
  parseKickUserBanned,
  type SubscriberBadge,
} from "@/backend/services/chat/kick-parser";

// ========== Fixtures ==========

function makeKickMessage(overrides: Partial<KickChatMessageEvent> = {}): KickChatMessageEvent {
  return {
    id: "msg-001",
    chatroom_id: 123,
    content: "Hello world",
    type: "message",
    created_at: "2025-01-01T00:00:00Z",
    sender: {
      id: 456,
      username: "TestUser",
      slug: "testuser",
      identity: {
        color: "#FF6B6B",
        badges: [],
      },
    },
    ...overrides,
  };
}

// ========== Badge Parsing ==========

describe("parseKickBadges", () => {
  it("returns empty array for empty badges", () => {
    expect(parseKickBadges([])).toEqual([]);
  });

  it("parses moderator badge with bundled URL", () => {
    const badges: KickBadge[] = [{ type: "moderator", text: "Moderator" }];
    const result = parseKickBadges(badges);

    expect(result).toHaveLength(1);
    expect(result[0].setId).toBe("moderator");
    expect(result[0].title).toBe("Moderator");
    expect(result[0].imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(result[0].version).toBe("1");
  });

  it("uses badge.text as title, falls back to type", () => {
    const badges: KickBadge[] = [{ type: "og", text: "" }];
    const result = parseKickBadges(badges);
    expect(result[0].title).toBe("og");
  });

  it("sets version from badge count", () => {
    const badges: KickBadge[] = [{ type: "subscriber", text: "Subscriber", count: 6 }];
    const result = parseKickBadges(badges);
    expect(result[0].version).toBe("6");
  });

  it("includes sub-gifter count in title", () => {
    const badges: KickBadge[] = [{ type: "sub_gifter", text: "Sub Gifter", count: 50 }];
    const result = parseKickBadges(badges);
    expect(result[0].title).toBe("Sub Gifter (50)");
  });

  it("does not add count to non-sub_gifter badges", () => {
    const badges: KickBadge[] = [{ type: "moderator", text: "Moderator", count: 5 }];
    const result = parseKickBadges(badges);
    expect(result[0].title).toBe("Moderator");
  });

  it("uses channel subscriber badge when available", () => {
    const badges: KickBadge[] = [{ type: "subscriber", text: "Sub", count: 6 }];
    const subscriberBadges: SubscriberBadge[] = [
      {
        id: 1,
        channel_id: 100,
        months: 1,
        badge_image: { src: "https://example.com/1m.png", srcset: "" },
      },
      {
        id: 2,
        channel_id: 100,
        months: 3,
        badge_image: { src: "https://example.com/3m.png", srcset: "" },
      },
      {
        id: 3,
        channel_id: 100,
        months: 6,
        badge_image: { src: "https://example.com/6m.png", srcset: "" },
      },
      {
        id: 4,
        channel_id: 100,
        months: 12,
        badge_image: { src: "https://example.com/12m.png", srcset: "" },
      },
    ];

    const result = parseKickBadges(badges, subscriberBadges);
    expect(result[0].imageUrl).toBe("https://example.com/6m.png");
  });

  it("picks highest qualifying subscriber badge tier", () => {
    const badges: KickBadge[] = [{ type: "subscriber", text: "Sub", count: 24 }];
    const subscriberBadges: SubscriberBadge[] = [
      {
        id: 1,
        channel_id: 100,
        months: 1,
        badge_image: { src: "https://example.com/1m.png", srcset: "" },
      },
      {
        id: 2,
        channel_id: 100,
        months: 12,
        badge_image: { src: "https://example.com/12m.png", srcset: "" },
      },
    ];

    const result = parseKickBadges(badges, subscriberBadges);
    expect(result[0].imageUrl).toBe("https://example.com/12m.png");
  });

  it("handles subgifter alias", () => {
    const badges: KickBadge[] = [{ type: "subgifter", text: "Sub Gifter", count: 10 }];
    const result = parseKickBadges(badges);
    expect(result[0].title).toBe("Sub Gifter (10)");
  });
});

// ========== Content Parsing ==========

describe("parseKickMessageContent", () => {
  it("parses plain text", () => {
    const fragments = parseKickMessageContent("hello world");
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toEqual({ type: "text", content: "hello world" });
  });

  it("parses Kick emote [emote:id:name]", () => {
    const fragments = parseKickMessageContent("hello [emote:12345:PeepoHappy] world");

    expect(fragments.length).toBeGreaterThanOrEqual(3);
    const emote = fragments.find((f) => f.type === "emote");
    expect(emote).toBeDefined();
    if (emote?.type === "emote") {
      expect(emote.id).toBe("12345");
      expect(emote.name).toBe("PeepoHappy");
      expect(emote.url).toBe("https://files.kick.com/emotes/12345/fullsize");
      expect(emote.isZeroWidth).toBe(false);
    }
  });

  it("parses multiple emotes", () => {
    const fragments = parseKickMessageContent("[emote:1:Kappa] [emote:2:LUL]");
    const emotes = fragments.filter((f) => f.type === "emote");
    expect(emotes).toHaveLength(2);
  });

  it("parses URLs into link fragments", () => {
    const fragments = parseKickMessageContent("check https://kick.com/channel");
    const link = fragments.find((f) => f.type === "link");
    expect(link).toBeDefined();
    if (link?.type === "link") {
      expect(link.url).toBe("https://kick.com/channel");
    }
  });

  it("parses @mentions into mention fragments", () => {
    const fragments = parseKickMessageContent("hello @testuser");
    const mention = fragments.find((f) => f.type === "mention");
    expect(mention).toBeDefined();
    if (mention?.type === "mention") {
      expect(mention.username).toBe("testuser");
    }
  });

  it("parses complex content with emotes, mentions, and links", () => {
    const content = "[emote:1:Kappa] @admin check https://kick.com [emote:2:LUL]";
    const fragments = parseKickMessageContent(content);

    const types = fragments.map((f) => f.type);
    expect(types).toContain("emote");
    expect(types).toContain("mention");
    expect(types).toContain("link");
  });

  it("handles empty string", () => {
    const fragments = parseKickMessageContent("");
    expect(fragments).toHaveLength(0);
  });
});

// ========== Chat Message Parsing ==========

describe("parseKickChatMessage", () => {
  it("produces a ChatMessage with correct fields", () => {
    const event = makeKickMessage();
    const msg = parseKickChatMessage(event, "somechannel");

    expect(msg.id).toBe("msg-001");
    expect(msg.platform).toBe("kick");
    expect(msg.type).toBe("message");
    expect(msg.channel).toBe("somechannel");
    expect(msg.userId).toBe("456");
    expect(msg.username).toBe("testuser");
    expect(msg.displayName).toBe("TestUser");
    expect(msg.color).toBe("#FF6B6B");
    expect(msg.rawContent).toBe("Hello world");
    expect(msg.isDeleted).toBe(false);
    expect(msg.isHighlighted).toBe(false);
    expect(msg.isAction).toBe(false);
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it("uses default color when identity.color is empty", () => {
    const event = makeKickMessage({
      sender: {
        id: 1,
        username: "NoColor",
        slug: "nocolor",
        identity: { color: "", badges: [] },
      },
    });
    const msg = parseKickChatMessage(event, "ch");
    expect(msg.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("parses reply info from metadata", () => {
    const event = makeKickMessage({
      type: "reply",
      metadata: {
        original_sender: { id: 789, username: "OrigUser" },
        original_message: { id: "orig-001", content: "original text" },
      },
    });
    const msg = parseKickChatMessage(event, "ch");

    expect(msg.replyTo).toBeDefined();
    expect(msg.replyTo!.parentMessageId).toBe("orig-001");
    expect(msg.replyTo!.parentUserId).toBe("789");
    expect(msg.replyTo!.parentUsername).toBe("OrigUser");
    expect(msg.replyTo!.parentMessageBody).toBe("original text");
  });

  it("omits replyTo when no metadata", () => {
    const event = makeKickMessage();
    const msg = parseKickChatMessage(event, "ch");
    expect(msg.replyTo).toBeUndefined();
  });

  it("parses emotes in content", () => {
    const event = makeKickMessage({
      content: "[emote:999:PogChamp] lets go",
    });
    const msg = parseKickChatMessage(event, "ch");

    const emote = msg.content.find((f) => f.type === "emote");
    expect(emote).toBeDefined();
    expect(msg.rawContent).toBe("PogChamp lets go");
  });

  it("passes subscriber badges through for badge resolution", () => {
    const event = makeKickMessage({
      sender: {
        id: 1,
        username: "Sub",
        slug: "sub",
        identity: {
          color: "#000",
          badges: [{ type: "subscriber", text: "Sub", count: 3 }],
        },
      },
    });
    const subBadges: SubscriberBadge[] = [
      {
        id: 1,
        channel_id: 100,
        months: 1,
        badge_image: { src: "https://example.com/1m.png", srcset: "" },
      },
    ];
    const msg = parseKickChatMessage(event, "ch", subBadges);
    expect(msg.badges).toHaveLength(1);
    expect(msg.badges[0].imageUrl).toBe("https://example.com/1m.png");
  });
});

// ========== Event Parsers ==========

describe("parseKickSubscription", () => {
  it("creates sub notice for first-time sub", () => {
    const event: KickSubscriptionEvent = {
      chatroom_id: 123,
      username: "NewSub",
      months: 1,
    };
    const notice = parseKickSubscription(event, "ch");

    expect(notice.platform).toBe("kick");
    expect(notice.channel).toBe("ch");
    expect(notice.type).toBe("sub");
    expect(notice.displayName).toBe("NewSub");
    expect(notice.username).toBe("newsub");
    expect(notice.systemMessage).toBe("NewSub subscribed!");
    expect(notice.months).toBe(1);
  });

  it("creates resub notice for multi-month sub", () => {
    const event: KickSubscriptionEvent = {
      chatroom_id: 123,
      username: "OldSub",
      months: 12,
    };
    const notice = parseKickSubscription(event, "ch");

    expect(notice.type).toBe("resub");
    expect(notice.systemMessage).toBe("OldSub has resubscribed for 12 months!");
    expect(notice.cumulativeMonths).toBe(12);
  });
});

describe("parseKickGiftedSub", () => {
  it("creates single gift message", () => {
    const event: KickGiftedSubEvent = {
      chatroom_id: 123,
      gifter_username: "Gifter",
      gifted_usernames: ["Lucky"],
    };
    const notice = parseKickGiftedSub(event, "ch");

    expect(notice.type).toBe("subgift");
    expect(notice.displayName).toBe("Gifter");
    expect(notice.systemMessage).toBe("Gifter gifted a subscription to Lucky!");
    expect(notice.giftCount).toBe(1);
  });

  it("creates multi-gift message", () => {
    const event: KickGiftedSubEvent = {
      chatroom_id: 123,
      gifter_username: "BigGifter",
      gifted_usernames: ["User1", "User2", "User3"],
    };
    const notice = parseKickGiftedSub(event, "ch");

    expect(notice.systemMessage).toBe("BigGifter gifted 3 subscriptions!");
    expect(notice.giftCount).toBe(3);
  });
});

describe("parseKickUserBanned", () => {
  it("creates permanent ban ClearChat", () => {
    const event: KickUserBannedEvent = {
      id: "ban-001",
      user: { id: 1, username: "BadUser", slug: "baduser" },
      banned_by: { id: 2, username: "Mod", slug: "mod" },
      permanent: true,
    };
    const result = parseKickUserBanned(event, "ch");

    expect(result.platform).toBe("kick");
    expect(result.targetUserId).toBe("1");
    expect(result.targetUsername).toBe("BadUser");
    expect(result.bannedByUsername).toBe("Mod");
    expect(result.duration).toBeUndefined();
    expect(result.isClearAll).toBe(false);
  });

  it("creates timeout with duration in seconds", () => {
    const event: KickUserBannedEvent = {
      id: "ban-002",
      user: { id: 1, username: "TimedOut", slug: "timedout" },
      permanent: false,
      duration: 5,
    };
    const result = parseKickUserBanned(event, "ch");

    expect(result.duration).toBe(300); // 5 minutes * 60
  });

  it("handles missing banned_by", () => {
    const event: KickUserBannedEvent = {
      id: "ban-003",
      user: { id: 1, username: "User", slug: "user" },
      permanent: true,
    };
    const result = parseKickUserBanned(event, "ch");
    expect(result.bannedByUsername).toBeUndefined();
  });
});

describe("parseKickMessageDeleted", () => {
  it("creates MessageDeletion", () => {
    const event: KickMessageDeletedEvent = {
      id: "del-001",
      message: { id: "msg-to-delete" },
    };
    const result = parseKickMessageDeleted(event, "ch");

    expect(result.platform).toBe("kick");
    expect(result.messageId).toBe("msg-to-delete");
    expect(result.channel).toBe("ch");
    expect(result.timestamp).toBeInstanceOf(Date);
  });
});

describe("parseKickChatCleared", () => {
  it("creates ClearChat with isClearAll", () => {
    const event: KickChatClearedEvent = { id: "clear-001" };
    const result = parseKickChatCleared(event, "ch");

    expect(result.platform).toBe("kick");
    expect(result.isClearAll).toBe(true);
    expect(result.channel).toBe("ch");
  });
});

describe("parseKickHostRaid", () => {
  it("creates raid UserNotice", () => {
    const event: KickHostRaidEvent = {
      chatroom_id: 123,
      host_username: "Raider",
      number_viewers: 500,
    };
    const notice = parseKickHostRaid(event, "ch");

    expect(notice.type).toBe("raid");
    expect(notice.displayName).toBe("Raider");
    expect(notice.viewerCount).toBe(500);
    expect(notice.systemMessage).toBe("Raider is raiding with 500 viewers!");
  });

  it("handles missing host_username", () => {
    const event: KickHostRaidEvent = { chatroom_id: 123 };
    const notice = parseKickHostRaid(event, "ch");
    expect(notice.displayName).toBe("");
    expect(notice.username).toBe("");
  });
});
