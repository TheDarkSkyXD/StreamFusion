import type {
  FollowedChannelsBody,
  FollowedClipsBody,
  FollowedStreamsBody,
  FollowedVideosBody
} from "@streamfusion/core/relay";

import {
  booleanAt,
  canonicalTimestamp,
  cursorFrom,
  dataFrom,
  firstString,
  helixDurationSeconds,
  identifierAt,
  nonNegativeNumberAt,
  sizedUrl,
  stringArrayAt,
  stringAt,
  type JsonRecord
} from "../utils/provider-json";

type Stream = FollowedStreamsBody["streams"][number];
type Channel = FollowedChannelsBody["channels"][number];
type Video = FollowedVideosBody["videos"][number];
type Clip = FollowedClipsBody["clips"][number];

export function twitchStreamsBody(payload: unknown): readonly Stream[] {
  return dataFrom(payload).flatMap((row) => {
    const stream = toStream(row);
    return stream === null ? [] : [stream];
  });
}

export function twitchChannelsBody(payload: unknown): readonly Channel[] {
  return dataFrom(payload).flatMap((row) => {
    const channel = toChannel(row);
    return channel === null ? [] : [channel];
  });
}

export function twitchVideosBody(payload: unknown): {
  readonly cursor: string | null;
  readonly videos: readonly Video[];
} {
  return {
    cursor: cursorFrom(payload),
    videos: dataFrom(payload).flatMap((row) => {
      const video = toVideo(row);
      return video === null ? [] : [video];
    })
  };
}

export function twitchClipsBody(payload: unknown): {
  readonly clips: readonly Clip[];
  readonly cursor: string | null;
} {
  return {
    clips: dataFrom(payload).flatMap((row) => {
      const clip = toClip(row);
      return clip === null ? [] : [clip];
    }),
    cursor: cursorFrom(payload)
  };
}

function toStream(record: JsonRecord): Stream | null {
  const id = identifierAt(record, "id");
  const channelId = identifierAt(record, "user_id");
  const channelName = firstString(record, ["user_login", "user_name"]);
  if (id === "" || channelId === "" || channelName === "") return null;
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  return {
    channelAvatar: "",
    channelDisplayName: firstString(record, ["user_name", "user_login"]),
    channelId,
    channelName,
    id,
    isLive: stringAt(record, "type") === "live",
    language: stringAt(record, "language"),
    platform: "twitch",
    startedAt: canonicalTimestamp(record.started_at),
    tags: stringArrayAt(record, "tags"),
    thumbnailUrl: sizedUrl(record, "thumbnail_url", "640", "360"),
    title: stringAt(record, "title"),
    viewerCount: nonNegativeNumberAt(record, "viewer_count"),
    ...(booleanAt(record, "is_mature") ? { isMature: true } : {}),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

function toChannel(record: JsonRecord): Channel | null {
  const id = identifierAt(record, "id");
  const username = firstString(record, ["login", "display_name"]);
  if (id === "" || username === "") return null;
  const createdAt = canonicalTimestamp(record.created_at);
  const viewCount = nonNegativeNumberAt(record, "view_count");
  return {
    avatarUrl: stringAt(record, "profile_image_url"),
    displayName: firstString(record, ["display_name", "login"]),
    id,
    isLive: false,
    isPartner: stringAt(record, "broadcaster_type") === "partner",
    isVerified: false,
    platform: "twitch",
    username,
    ...(createdAt === null ? {} : { createdAt }),
    ...(stringAt(record, "description") === ""
      ? {}
      : { bio: stringAt(record, "description") }),
    ...(stringAt(record, "offline_image_url") === ""
      ? {}
      : { bannerUrl: stringAt(record, "offline_image_url") }),
    ...(viewCount === 0 ? {} : { viewCount })
  };
}

function toVideo(record: JsonRecord): Video | null {
  const id = identifierAt(record, "id");
  const channelId = identifierAt(record, "user_id");
  const publishedAt = canonicalTimestamp(record.published_at);
  const url = stringAt(record, "url");
  if (id === "" || channelId === "" || publishedAt === null || url === "") {
    return null;
  }
  const type = videoType(stringAt(record, "type"));
  return {
    channelAvatar: "",
    channelDisplayName: firstString(record, ["user_name", "user_login"]),
    channelId,
    channelName: firstString(record, ["user_login", "user_name"]),
    duration: helixDurationSeconds(record, "duration"),
    id,
    platform: "twitch",
    publishedAt,
    thumbnailUrl: sizedUrl(record, "thumbnail_url", "640", "360"),
    title: stringAt(record, "title"),
    type,
    url,
    viewCount: nonNegativeNumberAt(record, "view_count"),
    ...(stringAt(record, "description") === ""
      ? {}
      : { description: stringAt(record, "description") })
  };
}

function toClip(record: JsonRecord): Clip | null {
  const id = identifierAt(record, "id");
  const channelId = identifierAt(record, "broadcaster_id");
  const clipUrl = firstString(record, ["url", "embed_url"]);
  const createdAt = canonicalTimestamp(record.created_at);
  if (id === "" || channelId === "" || clipUrl === "" || createdAt === null) {
    return null;
  }
  const categoryId = stringAt(record, "game_id");
  return {
    channelAvatar: "",
    channelDisplayName: firstString(record, [
      "broadcaster_name",
      "broadcaster_id"
    ]),
    channelId,
    channelName: firstString(record, ["broadcaster_name", "broadcaster_id"]),
    clipUrl,
    createdAt,
    creatorName: stringAt(record, "creator_name"),
    duration: helixDurationSeconds(record, "duration"),
    id,
    platform: "twitch",
    thumbnailUrl: stringAt(record, "thumbnail_url"),
    title: stringAt(record, "title"),
    viewCount: nonNegativeNumberAt(record, "view_count"),
    ...(categoryId === "" ? {} : { categoryId })
  };
}

function videoType(value: string): Video["type"] {
  if (value === "highlight" || value === "upload") return value;
  return "archive";
}
