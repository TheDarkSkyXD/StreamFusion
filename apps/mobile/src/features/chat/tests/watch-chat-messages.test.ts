import { describe, expect, it } from "vitest";

import {
  appendWatchChatMessage,
  parseKickChatFrame,
  parseTwitchPrivmsg,
} from "../domain/watch-chat-messages";

// Guards: guest IRC PRIVMSG and Kick ChatMessageEvent parse into displayable rows
describe("watch chat messages", () => {
  it("parses Twitch PRIVMSG tags and ignores pings", () => {
    expect(parseTwitchPrivmsg("PING :tmi.twitch.tv")).toBeNull();
    expect(
      parseTwitchPrivmsg(
        "@display-name=Ada;id=msg-1 :ada!ada@ada.tmi.twitch.tv PRIVMSG #alice :hello there",
      ),
    ).toEqual({
      displayName: "Ada",
      id: "msg-1",
      text: "hello there",
    });
  });

  it("parses Kick chat frames and caps the live buffer", () => {
    expect(
      parseKickChatFrame({
        content: "yo",
        id: 9,
        sender: { username: "Ada" },
      }),
    ).toEqual({ displayName: "Ada", id: "9", text: "yo" });
    const filled = Array.from({ length: 100 }, (_, index) => ({
      displayName: "n",
      id: `${index}`,
      text: `${index}`,
    }));
    expect(
      appendWatchChatMessage(filled, { displayName: "n", id: "100", text: "100" }),
    ).toHaveLength(100);
  });
});
