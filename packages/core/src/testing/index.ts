import type {
  ChannelIdentity,
  ChannelRef,
  Platform,
} from "@core/platform/index.ts";
import type { SafeAppError } from "@core/reliability/index.ts";
import {
  toSerializedTimestamp,
  type Category,
  type Channel,
  type Clip,
  type Stream,
  type Video,
} from "../content/index.ts";
import type { ChatMessage } from "../chat/index.ts";

export const platformFixtures = {
  twitch: "twitch",
  kick: "kick",
  twitchChannelById: { kind: "id", value: "71092938" },
  kickChannelBySlug: { kind: "slug", value: "xqc" },
  kickChannelByLegacyId: {
    platform: "kick",
    id: "421500",
    username: "xQc",
  },
  kickChannelByOfficialId: {
    platform: "kick",
    id: "411439",
    username: "XQC",
  },
} as const satisfies {
  twitch: Platform;
  kick: Platform;
  twitchChannelById: ChannelRef;
  kickChannelBySlug: ChannelRef;
  kickChannelByLegacyId: ChannelIdentity;
  kickChannelByOfficialId: ChannelIdentity;
};

export const reliabilityFixtures = {
  rateLimitedError: {
    code: "rate_limited",
    retry: { kind: "after", retryAtMs: 1_800_000_000_000 },
    diagnosticId: "bfbb7fa2-51cd-493e-86dc-ad98bd876e52",
    platform: "twitch",
  },
  terminalError: {
    code: "forbidden",
    retry: { kind: "none" },
    diagnosticId: "bd1a2d14-4675-4397-afaf-690b840d8023",
  },
} as const satisfies Record<string, SafeAppError>;

export const contentFixtures = {
  stream: {
    id: "stream-1",
    platform: "twitch",
    channelId: "channel-1",
    channelName: "streamer",
    channelDisplayName: "Streamer",
    channelAvatar: "https://cdn.example/avatar.png",
    channelIsVerified: true,
    title: "Live now",
    viewerCount: 42,
    thumbnailUrl: "https://cdn.example/stream.jpg",
    isLive: true,
    startedAt: toSerializedTimestamp("2026-08-31T12:00:00.000Z"),
    language: "en",
    tags: ["English"],
    categoryId: "category-1",
    categoryName: "Just Chatting",
  },
  channel: {
    id: "channel-1",
    platform: "kick",
    username: "streamer",
    displayName: "Streamer",
    avatarUrl: "https://cdn.example/avatar.png",
    isLive: false,
    isVerified: true,
    isPartner: true,
    followerCount: 100,
    createdAt: toSerializedTimestamp("2025-01-02T03:04:05.000Z"),
  },
  category: {
    id: "category-1",
    platform: "kick",
    name: "Just Chatting",
    boxArtUrl: "https://cdn.example/category.jpg",
    viewerCount: 1000,
    tags: ["IRL"],
  },
  video: {
    id: "video-1",
    platform: "twitch",
    channelId: "channel-1",
    channelName: "streamer",
    channelDisplayName: "Streamer",
    channelAvatar: "https://cdn.example/avatar.png",
    title: "Past stream",
    thumbnailUrl: "https://cdn.example/video.jpg",
    duration: 3600,
    viewCount: 1200,
    publishedAt: toSerializedTimestamp("2026-08-30T12:00:00.000Z"),
    url: "https://example.test/videos/video-1",
    type: "archive",
  },
  clip: {
    id: "clip-1",
    platform: "kick",
    channelId: "channel-1",
    channelName: "streamer",
    channelDisplayName: "Streamer",
    channelAvatar: "https://cdn.example/avatar.png",
    title: "A clip",
    thumbnailUrl: "https://cdn.example/clip.jpg",
    clipUrl: "https://example.test/clips/clip-1",
    duration: 30,
    viewCount: 500,
    createdAt: toSerializedTimestamp("2026-08-30T12:30:00.000Z"),
    creatorName: "viewer",
    categoryId: "category-1",
    categoryName: "Just Chatting",
  },
} as const satisfies {
  stream: Stream;
  channel: Channel;
  category: Category;
  video: Video;
  clip: Clip;
};

export const chatFixtures = {
  message: {
    id: "message-1",
    platform: "kick",
    type: "message",
    channel: "streamer",
    userId: "user-1",
    username: "viewer",
    displayName: "Viewer",
    color: "#53FC18",
    badges: [
      {
        setId: "subscriber",
        version: "3",
        imageUrl: "https://cdn.example/badge.png",
        title: "Subscriber",
      },
    ],
    content: [
      { type: "text", content: "hello " },
      {
        type: "emote",
        id: "emote-1",
        name: "wave",
        url: "https://cdn.example/emote.png",
        provider: "7tv",
        isAnimated: true,
      },
    ],
    rawContent: "hello wave",
    timestamp: toSerializedTimestamp("2026-08-31T12:00:00.000Z"),
    isDeleted: true,
    isHighlighted: false,
    isAction: false,
    deletedAt: toSerializedTimestamp("2026-08-31T12:01:00.000Z"),
    deletedByUser: {
      userId: "moderator-1",
      username: "moderator",
      displayName: "Moderator",
      badges: [],
    },
    replyTo: {
      parentMessageId: "message-0",
      parentUserId: "user-2",
      parentUsername: "other-viewer",
      parentDisplayName: "Other Viewer",
      parentMessageBody: "hi",
    },
  },
} as const satisfies { message: ChatMessage };
