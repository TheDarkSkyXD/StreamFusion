import type {
  FollowedChannelsBody,
  FollowedStreamsBody
} from "@streamfusion/core/relay";

import {
  booleanAt,
  dataFrom,
  firstIdentifier,
  firstString,
  hasKey,
  helixTimestamp,
  identifierAt,
  recordAt,
  stringAt,
  stringArrayAt,
  type JsonRecord
} from "../utils/provider-json";

type Stream = FollowedStreamsBody["streams"][number];
type Channel = FollowedChannelsBody["channels"][number];

export function kickStreamsFrom(payload: unknown): readonly Stream[] {
  return dataFrom(payload).flatMap((row) => {
    const stream = toStream(row);
    return stream === null ? [] : [stream];
  });
}

export function kickChannelsFrom(payload: unknown): readonly Channel[] {
  return dataFrom(payload).flatMap((row) => {
    const channel = toChannel(row);
    return channel === null ? [] : [channel];
  });
}

function toStream(record: JsonRecord): Stream | null {
  const channel = recordAt(record, "channel") ?? record;
  const user = recordAt(channel, "user") ?? channel;
  const category =
    recordAt(record, "category") ?? firstRecord(record, "categories");
  const id = firstIdentifier(record, ["id", "slug", "session_id"]);
  const channelId = firstIdentifier(channel, ["id", "slug"]);
  const channelName = firstString(channel, ["slug", "username", "name"]);
  if (id === "" || channelId === "" || channelName === "") return null;
  const categoryId = category === null ? "" : identifierAt(category, "id");
  const categoryName = category === null ? "" : stringAt(category, "name");
  return {
    channelAvatar: firstString(user, [
      "profile_pic",
      "profile_picture",
      "avatar"
    ]),
    channelDisplayName: firstString(user, ["username", "name", "slug"]),
    channelId,
    channelName,
    id,
    isLive: booleanAt(record, "is_live") || !hasKey(record, "is_live"),
    language: stringAt(record, "language"),
    platform: "kick",
    startedAt: helixTimestamp(
      firstString(record, ["started_at", "start_time", "created_at"])
    ),
    tags: stringArrayAt(record, "tags"),
    thumbnailUrl: firstString(record, ["thumbnail_url", "thumbnail", "image"]),
    title: firstString(record, ["session_title", "title", "stream_title"]),
    viewerCount: firstNumber(record, ["viewer_count", "viewers"]),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

function toChannel(record: JsonRecord): Channel | null {
  const user = recordAt(record, "user") ?? record;
  const id = firstIdentifier(record, ["id", "slug"]);
  const username = firstString(record, ["slug", "username", "name"]);
  if (id === "" || username === "") return null;
  return {
    avatarUrl: firstString(user, ["profile_pic", "profile_picture", "avatar"]),
    displayName: firstString(user, ["username", "name", "slug"]),
    id,
    isLive: booleanAt(record, "is_live"),
    isPartner: booleanAt(record, "is_partner"),
    isVerified: booleanAt(record, "verified"),
    platform: "kick",
    username
  };
}

function firstRecord(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  return typeof first === "object" && first !== null && !Array.isArray(first)
    ? (first as JsonRecord)
    : null;
}

function firstNumber(record: JsonRecord, keys: readonly string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}
