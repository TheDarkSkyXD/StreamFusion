import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@shared/chat-types";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import {
  createMultiChatChannel,
  dedupeMultiChatChannels,
  mergeChatMessageBuckets,
} from "@/features/chat/data/multi-chat-feed";

function message(
  id: string,
  platform: ChatPlatform,
  channel: string,
  timestamp: number
): ChatMessage {
  return {
    id,
    platform,
    channel,
    type: "message",
    userId: id,
    username: id,
    displayName: id,
    color: "#fff",
    badges: [],
    content: [{ type: "text", content: id }],
    rawContent: id,
    timestamp: new Date(timestamp),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

describe("multi-chat feed model", () => {
  it("normalizes and deduplicates channels without crossing platforms", () => {
    const channels = dedupeMultiChatChannels([
      createMultiChatChannel("twitch", " XQC "),
      createMultiChatChannel("twitch", "#xqc"),
      createMultiChatChannel("kick", "xQc"),
    ]);

    expect(channels.map((channel) => channel.key)).toEqual(["twitch:xqc", "kick:xqc"]);
  });

  it("merges chronological buckets with channel-scoped message keys", () => {
    const twitch = createMultiChatChannel("twitch", "xqc", "xQc on Twitch");
    const kick = createMultiChatChannel("kick", "xqc", "xQc on Kick");
    const merged = mergeChatMessageBuckets([twitch, kick], {
      [twitch.key]: [message("same-id", "twitch", "xqc", 1), message("tw-2", "twitch", "xqc", 3)],
      [kick.key]: [message("same-id", "kick", "xqc", 2)],
    });

    expect(merged.map((entry) => entry.message.id)).toEqual(["same-id", "same-id", "tw-2"]);
    expect(new Set(merged.map((entry) => entry.key)).size).toBe(3);
    expect(merged.map((entry) => entry.channelKey)).toEqual([
      "twitch:xqc",
      "kick:xqc",
      "twitch:xqc",
    ]);
  });
});
