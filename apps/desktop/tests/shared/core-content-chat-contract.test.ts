import { describe, expect, it } from "vitest";

import { chatMessageSchema } from "@streamfusion/core/chat";
import {
  categorySchema,
  channelSchema,
  clipSchema,
  streamSchema,
  videoSchema,
} from "@streamfusion/core/content";
import { chatFixtures, contentFixtures } from "@streamfusion/core/testing";
import type { ChatMessage } from "@shared/chat-types";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "@shared/platform-types";

describe("shared Core content and chat compatibility", () => {
  it("keeps portable Desktop content fields compatible with Core schemas", () => {
    const stream: UnifiedStream = {
      ...contentFixtures.stream,
      tags: [...contentFixtures.stream.tags],
    };
    const channel: UnifiedChannel = { ...contentFixtures.channel };
    const category: UnifiedCategory = {
      ...contentFixtures.category,
      tags: [...contentFixtures.category.tags],
    };
    const video: UnifiedVideo = { ...contentFixtures.video };
    const clip: UnifiedClip = {
      ...contentFixtures.clip,
      embedUrl: "https://player.example.test/clip-1",
    };
    const { embedUrl: _embedUrl, ...portableClip } = clip;

    expect(streamSchema.is(stream)).toBe(true);
    expect(channelSchema.is(channel)).toBe(true);
    expect(categorySchema.is(category)).toBe(true);
    expect(videoSchema.is(video)).toBe(true);
    expect(clipSchema.is(portableClip)).toBe(true);
  });

  it("keeps provider adapter fields outside the Core Channel contract", () => {
    const desktopChannel: UnifiedChannel = {
      ...contentFixtures.channel,
      chatroomId: 123,
      kickChannelId: "456",
      kickUserId: "789",
    };

    expect(channelSchema.is(desktopChannel)).toBe(false);
  });

  it("converts the Desktop Date representation into the serialized Core chat contract", () => {
    const desktopMessage: ChatMessage = {
      ...chatFixtures.message,
      badges: [...chatFixtures.message.badges],
      content: [...chatFixtures.message.content],
      timestamp: new Date(chatFixtures.message.timestamp),
      deletedAt: new Date(chatFixtures.message.deletedAt),
      deletedByUser: {
        ...chatFixtures.message.deletedByUser,
        badges: [...chatFixtures.message.deletedByUser.badges],
      },
    };
    const serializedMessage = {
      ...desktopMessage,
      timestamp: desktopMessage.timestamp.toISOString(),
      deletedAt: desktopMessage.deletedAt?.toISOString(),
    };

    expect(chatMessageSchema.is(serializedMessage)).toBe(true);
    expect(JSON.parse(JSON.stringify(serializedMessage))).toEqual(serializedMessage);
  });
});
