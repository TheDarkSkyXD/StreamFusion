import { describe, expect, it } from "vitest";

import { badgesIncludeTwitchModerator } from "../domain/twitch-moderator-badge";
import {
  appendWatchChatMessage,
  parseIrcBadgesTag,
  parseKickChatFrame,
  parseTwitchPrivmsg,
} from "../domain/watch-chat-messages";
import {
  resetTwitchGlobalBadgeCatalogForTests,
  resolveTwitchBadges,
} from "../domain/twitch-global-badge-catalog";
import { resolveChatUsernameColor } from "../domain/resolve-chat-username-color";

// Guards: guest IRC PRIVMSG and Kick ChatMessageEvent parse into displayable rows
describe("watch chat messages", () => {
  it("parses Twitch PRIVMSG tags and ignores pings", () => {
    expect(parseTwitchPrivmsg("PING :tmi.twitch.tv")).toBeNull();
    expect(
      parseTwitchPrivmsg(
        "@badge-info=;badges=;color=#FF7F50;display-name=Ada;id=msg-1 :ada!ada@ada.tmi.twitch.tv PRIVMSG #alice :hello there",
      ),
    ).toEqual({
      badges: [],
      color: "#ff7f50",
      displayName: "Ada",
      id: "msg-1",
      text: "hello there",
      username: "ada",
    });
  });

  it("parses lead_moderator from PRIVMSG badges and treats it as mod", () => {
    resetTwitchGlobalBadgeCatalogForTests();
    const message = parseTwitchPrivmsg(
      "@badges=lead_moderator/1,subscriber/12;color=#1E90FF;display-name=LeadMod;id=msg-lead :lead!lead@lead.tmi.twitch.tv PRIVMSG #alice :mod check",
    );
    expect(message).toMatchObject({
      color: "#1e90ff",
      displayName: "LeadMod",
      id: "msg-lead",
      text: "mod check",
      username: "lead",
    });
    expect(message?.badges.map((badge) => badge.setId)).toEqual([
      "lead_moderator",
      "subscriber",
    ]);
    expect(badgesIncludeTwitchModerator(message?.badges ?? [])).toBe(true);
    expect(parseIrcBadgesTag("lead_moderator/1")).toEqual([
      { setId: "lead_moderator", version: "1" },
    ]);
    expect(
      badgesIncludeTwitchModerator(
        resolveTwitchBadges([{ setId: "lead_moderator", version: "1" }]),
      ),
    ).toBe(true);
  });

  it("parses Kick chat frames with identity color and caps the live buffer", () => {
    expect(
      parseKickChatFrame({
        content: "yo",
        id: 9,
        sender: {
          identity: { color: "#53FC18" },
          slug: "ada",
          username: "Ada",
        },
      }),
    ).toEqual({
      badges: [],
      color: "#53fc18",
      displayName: "Ada",
      id: "9",
      text: "yo",
      username: "ada",
    });
    const filled = Array.from({ length: 100 }, (_, index) => ({
      badges: [] as const,
      displayName: "n",
      id: `${index}`,
      text: `${index}`,
      username: "n",
    }));
    expect(
      appendWatchChatMessage(filled, {
        badges: [],
        displayName: "n",
        id: "100",
        text: "100",
        username: "n",
      }),
    ).toHaveLength(100);
  });

  it("resolves Twitch IRC colors the same way desktop chat does", () => {
    expect(
      resolveChatUsernameColor({
        color: "#ff7f50",
        platform: "twitch",
        readableColorForUncolored: true,
        themeAdaptUsernameColor: true,
        username: "ada",
      }),
    ).toBe("#ff7f50");
    expect(
      resolveChatUsernameColor({
        platform: "twitch",
        readableColorForUncolored: false,
        themeAdaptUsernameColor: true,
        username: "ada",
      }),
    ).toBe("#9146ff");
    expect(
      resolveChatUsernameColor({
        color: "#000080",
        platform: "twitch",
        readableColorForUncolored: true,
        themeAdaptUsernameColor: true,
        username: "ada",
      }),
    ).not.toBe("#000080");
  });
});