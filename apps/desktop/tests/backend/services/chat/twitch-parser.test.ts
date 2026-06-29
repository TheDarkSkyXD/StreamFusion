import { describe, expect, it } from "vitest";

import {
  getDefaultColor,
  parseBadgeTags,
  parseTwitchMessage,
  type TwitchTags,
} from "@/backend/services/chat/twitch-parser";

describe("getDefaultColor", () => {
  it("returns a hex color string", () => {
    const color = getDefaultColor("testuser");
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("returns consistent color for same username", () => {
    expect(getDefaultColor("alice")).toBe(getDefaultColor("alice"));
  });

  it("returns different colors for different usernames", () => {
    const colorA = getDefaultColor("alice");
    const colorB = getDefaultColor("bob");
    expect(colorA).not.toBe(colorB);
  });
});

describe("parseBadgeTags", () => {
  it("returns empty array for undefined input", () => {
    expect(parseBadgeTags(undefined)).toEqual([]);
  });

  it("parses single badge", () => {
    const badges = parseBadgeTags({ moderator: "1" });
    expect(badges).toHaveLength(1);
    expect(badges[0]).toEqual({
      setId: "moderator",
      version: "1",
      imageUrl: "",
      title: "moderator",
    });
  });

  it("parses multiple badges", () => {
    const badges = parseBadgeTags({
      broadcaster: "1",
      subscriber: "12",
      turbo: "1",
    });
    expect(badges).toHaveLength(3);
    expect(badges.map((b) => b.setId)).toEqual(["broadcaster", "subscriber", "turbo"]);
    expect(badges[1].version).toBe("12");
  });
});

// Guards: Twitch tag parsing preserves distinct highlight kinds for first-time chat, paid highlighted messages, and bits cheers
describe("parseTwitchMessage", () => {
  function makeTags(overrides: Partial<TwitchTags> = {}): TwitchTags {
    return {
      "display-name": "TestUser",
      "user-id": "12345",
      id: "msg-001",
      color: "#FF0000",
      badges: { subscriber: "6" },
      emotes: null,
      mod: false,
      subscriber: true,
      turbo: false,
      ...overrides,
    };
  }

  it("creates a ChatMessage with correct platform and channel", () => {
    const msg = parseTwitchMessage("#mychannel", makeTags(), "Hello!", false);

    expect(msg.platform).toBe("twitch");
    expect(msg.channel).toBe("mychannel");
    expect(msg.rawContent).toBe("Hello!");
    expect(msg.displayName).toBe("TestUser");
    expect(msg.userId).toBe("12345");
    expect(msg.color).toBe("#FF0000");
    expect(msg.isDeleted).toBe(false);
  });

  it("strips # from channel name", () => {
    const msg = parseTwitchMessage("#test", makeTags(), "hi", false);
    expect(msg.channel).toBe("test");
  });

  it("uses default color when none provided", () => {
    const msg = parseTwitchMessage("#ch", makeTags({ color: "" }), "hi", false);
    expect(msg.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(msg.color).toBe(getDefaultColor("testuser"));
  });

  it("sets type to action for /me messages", () => {
    const msg = parseTwitchMessage("#ch", makeTags({ "message-type": "action" }), "dances", false);
    expect(msg.type).toBe("action");
    expect(msg.isAction).toBe(true);
  });

  it("sets type to bits when bits tag is present", () => {
    const msg = parseTwitchMessage("#ch", makeTags({ bits: "100" }), "cheer100", false);
    expect(msg.type).toBe("bits");
    expect(msg.bits).toBe(100);
    expect(msg.highlightKind).toBe("cheer");
  });

  it("marks first-msg as highlighted", () => {
    const msg = parseTwitchMessage("#ch", makeTags({ "first-msg": true }), "hi", false);
    expect(msg.isHighlighted).toBe(true);
    expect(msg.highlightKind).toBe("first-time-chat");
  });

  it("marks custom-reward-id as highlighted", () => {
    const msg = parseTwitchMessage(
      "#ch",
      makeTags({ "custom-reward-id": "reward-abc" }),
      "hi",
      false
    );
    expect(msg.isHighlighted).toBe(true);
    expect(msg.highlightKind).toBe("highlighted-message");
  });

  it("parses reply info when reply tags are present", () => {
    const msg = parseTwitchMessage(
      "#ch",
      makeTags({
        "reply-parent-msg-id": "parent-123",
        "reply-parent-user-id": "user-456",
        "reply-parent-user-login": "parentuser",
        "reply-parent-display-name": "ParentUser",
        "reply-parent-msg-body": "original message",
      }),
      "my reply",
      false
    );

    expect(msg.replyTo).toBeDefined();
    expect(msg.replyTo!.parentMessageId).toBe("parent-123");
    expect(msg.replyTo!.parentUserId).toBe("user-456");
    expect(msg.replyTo!.parentUsername).toBe("parentuser");
    expect(msg.replyTo!.parentDisplayName).toBe("ParentUser");
    expect(msg.replyTo!.parentMessageBody).toBe("original message");
  });

  it("omits replyTo when no reply tags present", () => {
    const msg = parseTwitchMessage("#ch", makeTags(), "hi", false);
    expect(msg.replyTo).toBeUndefined();
  });

  it("generates UUID for id when tags.id is missing", () => {
    const msg = parseTwitchMessage("#ch", makeTags({ id: undefined }), "hi", false);
    expect(msg.id).toBeTruthy();
    expect(msg.id.length).toBeGreaterThan(0);
  });

  it("parses emotes into content fragments", () => {
    const msg = parseTwitchMessage(
      "#ch",
      makeTags({
        emotes: { "25": ["0-4"] },
      }),
      "Kappa hello",
      false
    );

    expect(msg.content.length).toBeGreaterThanOrEqual(2);

    const emoteFragment = msg.content.find((f) => f.type === "emote");
    expect(emoteFragment).toBeDefined();
    expect(emoteFragment!.type).toBe("emote");
    if (emoteFragment!.type === "emote") {
      expect(emoteFragment!.name).toBe("Kappa");
      expect(emoteFragment!.id).toBe("25");
      expect(emoteFragment!.url).toContain("25");
    }
  });

  it("parses text with URL into link fragment", () => {
    const msg = parseTwitchMessage("#ch", makeTags(), "check https://twitch.tv please", false);

    const linkFragment = msg.content.find((f) => f.type === "link");
    expect(linkFragment).toBeDefined();
    if (linkFragment!.type === "link") {
      expect(linkFragment!.url).toBe("https://twitch.tv");
    }
  });

  it("parses text with @mention into mention fragment", () => {
    const msg = parseTwitchMessage("#ch", makeTags(), "hello @someuser how are you", false);

    const mentionFragment = msg.content.find((f) => f.type === "mention");
    expect(mentionFragment).toBeDefined();
    if (mentionFragment!.type === "mention") {
      expect(mentionFragment!.username).toBe("someuser");
    }
  });

  it("handles multiple emotes with correct positions", () => {
    const msg = parseTwitchMessage(
      "#ch",
      makeTags({
        emotes: { "25": ["0-4", "12-16"] },
      }),
      "Kappa test Kappa",
      false
    );

    const emoteFragments = msg.content.filter((f) => f.type === "emote");
    expect(emoteFragments).toHaveLength(2);
  });

  it("plain text message produces text fragment", () => {
    const msg = parseTwitchMessage("#ch", makeTags(), "just plain text", false);

    expect(msg.content).toHaveLength(1);
    expect(msg.content[0].type).toBe("text");
    if (msg.content[0].type === "text") {
      expect(msg.content[0].content).toBe("just plain text");
    }
  });

  it("lowercases username from display-name", () => {
    const msg = parseTwitchMessage("#ch", makeTags({ "display-name": "CamelCase" }), "hi", false);
    expect(msg.username).toBe("camelcase");
  });

  it("sets isAction false for normal messages", () => {
    const msg = parseTwitchMessage("#ch", makeTags(), "hi", false);
    expect(msg.isAction).toBe(false);
  });

  it("sets bits to undefined when no bits tag", () => {
    const msg = parseTwitchMessage("#ch", makeTags(), "hi", false);
    expect(msg.bits).toBeUndefined();
  });

  it("default message type is message", () => {
    const msg = parseTwitchMessage("#ch", makeTags(), "hi", false);
    expect(msg.type).toBe("message");
  });
});
