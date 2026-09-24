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

// Guards: guest IRC PRIVMSG and Kick ChatMessageEvent parse into displayable rows
describe("watch chat messages", () => {
  it("parses Twitch PRIVMSG tags and ignores pings", () => {
    expect(parseTwitchPrivmsg("PING :tmi.twitch.tv")).toBeNull();
    expect(
      parseTwitchPrivmsg(
        "@display-name=Ada;id=msg-1 :ada!ada@ada.tmi.twitch.tv PRIVMSG #alice :hello there",
      ),
    ).toEqual({
      badges: [],
      displayName: "Ada",
      id: "msg-1",
      text: "hello there",
    });
  });

  it("parses lead_moderator from PRIVMSG badges and treats it as mod", () => {
    resetTwitchGlobalBadgeCatalogForTests();
    const message = parseTwitchPrivmsg(
      "@badges=lead_moderator/1,subscriber/12;display-name=LeadMod;id=msg-lead :lead!lead@lead.tmi.twitch.tv PRIVMSG #alice :mod check",
    );
    expect(message).toMatchObject({
      displayName: "LeadMod",
      id: "msg-lead",
      text: "mod check",
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

  it("parses Kick chat frames and caps the live buffer", () => {
    expect(
      parseKickChatFrame({
        content: "yo",
        id: 9,
        sender: { username: "Ada" },
      }),
    ).toEqual({ badges: [], displayName: "Ada", id: "9", text: "yo" });
    const filled = Array.from({ length: 100 }, (_, index) => ({
      badges: [],
      displayName: "n",
      id: `${index}`,
      text: `${index}`,
    }));
    expect(
      appendWatchChatMessage(filled, {
        badges: [],
        displayName: "n",
        id: "100",
        text: "100",
      }),
    ).toHaveLength(100);
  });
});
