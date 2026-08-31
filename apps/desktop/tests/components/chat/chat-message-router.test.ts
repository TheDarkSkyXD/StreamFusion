import { beforeEach, describe, expect, it } from "vitest";

import { kickChatService } from "@backend/services/chat/kick-chat";
import type { ChatMessage } from "@shared/chat-types";
import { registerChatMessageRoute } from "@/features/chat/data/chat-message-router";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

function message(id: string, channel: string): ChatMessage {
  return {
    id,
    platform: "kick",
    channel,
    type: "message",
    userId: id,
    username: id,
    displayName: id,
    color: "#fff",
    badges: [],
    content: [{ type: "text", content: id }],
    rawContent: id,
    timestamp: new Date("2026-08-31T00:00:00Z"),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

describe("chat message router", () => {
  beforeEach(() => {
    useChatStore.getState().cleanupBatching();
    useChatStore.setState({
      messagesByChannel: {},
      usersByChannel: {},
      chatterCountByChannel: {},
      pausedChannels: new Set(),
      batchingEnabled: false,
    });
  });

  it("routes only registered channels and detaches after the final release", () => {
    const unregister = registerChatMessageRoute({ platform: "kick", channel: " XQC " });

    kickChatService.emit("message", message("xqc-1", "xqc"));
    kickChatService.emit("message", message("other-1", "another-channel"));

    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey("kick", "xqc")]?.map(({ id }) => id)
    ).toEqual(["xqc-1"]);
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey("kick", "another-channel")]
    ).toBeUndefined();

    unregister();
    kickChatService.emit("message", message("xqc-2", "xqc"));

    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey("kick", "xqc")]?.map(({ id }) => id)
    ).toEqual(["xqc-1"]);
  });
});
