/**
 * Parser emote-fragment tests (U3).
 *
 * Both the Twitch IRC parser and the Kick Pusher parser build emote fragments
 * directly from wire data (IRC `emotes` tags / `[emote:id:name]` markers) — they
 * do NOT look up the third-party Emote record. Native Twitch/Kick emotes are
 * never zero-width overlays, so `isZeroWidth` is threaded through as `false`.
 * These tests lock that contract so the renderer's overlay gate stays uniform
 * across fragment sources.
 */

import { describe, expect, it } from "vitest";

import {
  type KickChatMessageEvent,
  parseKickChatMessage,
} from "@backend/services/chat/kick-parser";
import { parseTwitchMessage, type TwitchTags } from "@backend/services/chat/twitch-parser";
import { ContentFragment } from "@streamfusion/core/chat";

function emoteFragments(fragments: ContentFragment[]) {
  return fragments.filter((f): f is Extract<ContentFragment, { type: "emote" }> => f.type === "emote");
}

describe("twitch-parser emote fragments (U3)", () => {
  it("populates isZeroWidth=false on native Twitch emote fragments", () => {
    const tags: TwitchTags = {
      "display-name": "Ninja",
      "user-id": "1",
      id: "msg-1",
      // Kappa at positions 0-4
      emotes: { "25": ["0-4"] },
    };
    const msg = parseTwitchMessage("#chan", tags, "Kappa hello", false);
    const emotes = emoteFragments(msg.content);
    expect(emotes).toHaveLength(1);
    expect(emotes[0].name).toBe("Kappa");
    expect(emotes[0].isZeroWidth).toBe(false);
  });
});

describe("kick-parser emote fragments (U3)", () => {
  function kickEvent(content: string): KickChatMessageEvent {
    return {
      id: "k-1",
      chatroom_id: 1,
      content,
      type: "message",
      created_at: new Date().toISOString(),
      sender: {
        id: 2,
        username: "Streamer",
        slug: "streamer",
        identity: { color: "#00ff00", badges: [] },
      },
    };
  }

  it("populates isZeroWidth=false on native Kick emote fragments", () => {
    const msg = parseKickChatMessage(kickEvent("[emote:42:KEKW] hi"), "streamer");
    const emotes = emoteFragments(msg.content);
    expect(emotes).toHaveLength(1);
    expect(emotes[0].name).toBe("KEKW");
    expect(emotes[0].isZeroWidth).toBe(false);
  });
});
