import {
  toSerializedTimestamp,
  type Channel,
  type Clip,
  type Stream,
  type Video,
} from "@streamfusion/core/content";

import type {
  ChannelPageOutcome,
  PlatformReadOutcome,
} from "../../capabilities/platform-reads";
import {
  canonicalTimestamp,
  helixDurationSeconds,
  identifierField,
  numberField,
  stringField,
} from "../../utils/helix-media";
import {
  helixTags,
  twitchChannelVerified,
} from "../../utils/catalog-fields";

export function toHelixChannel(
  user: Record<string, unknown>,
  channel: Record<string, unknown>,
  isLive: boolean,
): Channel {
  const createdAt = canonicalTimestamp(stringField(user, "created_at"));
  const categoryId = stringField(channel, "game_id");
  const categoryName = stringField(channel, "game_name");
  const bio = stringField(user, "description") || stringField(channel, "title");
  const bannerUrl = stringField(user, "offline_image_url");
  return {
    avatarUrl: stringField(user, "profile_image_url"),
    displayName: stringField(user, "display_name") || stringField(user, "login"),
    id: identifierField(user, "id"),
    isLive,
    isPartner: stringField(user, "broadcaster_type") === "partner",
    isVerified: twitchChannelVerified(stringField(user, "broadcaster_type")),
    platform: "twitch",
    username: stringField(user, "login") || stringField(user, "display_name"),
    ...(bannerUrl === "" ? {} : { bannerUrl }),
    ...(bio === "" ? {} : { bio }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName }),
    ...(stringField(channel, "title") === ""
      ? {}
      : { lastStreamTitle: stringField(channel, "title") }),
  };
}

export function toHelixLive(
  record: Record<string, unknown>,
  channel: Channel,
): Stream {
  const startedAt = canonicalTimestamp(stringField(record, "started_at"));
  const categoryId = stringField(record, "game_id");
  const categoryName = stringField(record, "game_name");
  return {
    channelAvatar: channel.avatarUrl,
    channelDisplayName: channel.displayName,
    channelId: channel.id,
    channelName: channel.username,
    id: identifierField(record, "id"),
    isLive: true,
    language: stringField(record, "language"),
    platform: "twitch",
    startedAt: startedAt ?? null,
    tags: helixTags(record),
    thumbnailUrl: stringField(record, "thumbnail_url")
      .replaceAll("{width}", "640")
      .replaceAll("{height}", "360"),
    title: stringField(record, "title") || channel.lastStreamTitle || channel.displayName,
    viewerCount: numberField(record, "viewer_count"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName }),
    ...(channel.isVerified || channel.isPartner
      ? { channelIsVerified: true }
      : {}),
  };
}

export function toHelixVideo(
  record: Record<string, unknown>,
  user: Record<string, unknown>,
): Video {
  const publishedAt =
    canonicalTimestamp(stringField(record, "published_at")) ??
    canonicalTimestamp(stringField(record, "created_at")) ??
    toSerializedTimestamp("1970-01-01T00:00:00.000Z");
  const type = stringField(record, "type");
  return {
    channelAvatar: stringField(user, "profile_image_url"),
    channelDisplayName: stringField(user, "display_name") || stringField(user, "login"),
    channelId: identifierField(user, "id"),
    channelName: stringField(user, "login"),
    duration: helixDurationSeconds(stringField(record, "duration")),
    id: identifierField(record, "id"),
    platform: "twitch",
    publishedAt,
    thumbnailUrl: stringField(record, "thumbnail_url")
      .replaceAll("%{width}", "320")
      .replaceAll("%{height}", "180"),
    title: stringField(record, "title"),
    type: type === "highlight" || type === "upload" ? type : "archive",
    url: stringField(record, "url"),
    viewCount: numberField(record, "view_count"),
  };
}

export function toHelixClip(
  record: Record<string, unknown>,
  user: Record<string, unknown>,
): Clip {
  return {
    channelAvatar: stringField(user, "profile_image_url"),
    channelDisplayName: stringField(user, "display_name") || stringField(user, "login"),
    channelId: identifierField(user, "id"),
    channelName: stringField(user, "login"),
    clipUrl: stringField(record, "url"),
    createdAt:
      canonicalTimestamp(stringField(record, "created_at")) ??
      toSerializedTimestamp("1970-01-01T00:00:00.000Z"),
    creatorName: stringField(record, "creator_name"),
    duration: numberField(record, "duration"),
    id: identifierField(record, "id"),
    platform: "twitch",
    thumbnailUrl: stringField(record, "thumbnail_url"),
    title: stringField(record, "title"),
    viewCount: numberField(record, "view_count"),
  };
}

export function failedHelixPage(code: string): ChannelPageOutcome {
  return {
    cache: { kind: "miss" },
    channel: null,
    error: {
      code,
      retry: code === "cancelled" ? "none" : "manual",
    },
    live: null,
    path: helixFailurePath(code),
    platform: "twitch",
    status: "failed",
  };
}

export function failedHelixCollection<T>(code: string): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path: helixFailurePath(code),
    platform: "twitch",
    status: "failed",
  };
}

function helixFailurePath(code: string): ChannelPageOutcome["path"] {
  if (code === "auth-lost" || code === "signed-out-login-required") {
    return {
      kind: "unavailable",
      platform: "twitch",
      reason: code === "auth-lost" ? "auth-lost" : "signed-out-login-required",
    };
  }
  return { kind: "direct", platform: "twitch" };
}
