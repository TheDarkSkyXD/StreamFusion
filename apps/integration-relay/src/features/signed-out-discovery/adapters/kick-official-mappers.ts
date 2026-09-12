import type {
  SignedOutCategoriesBody,
  SignedOutSearchBody,
  SignedOutTopStreamsBody
} from "@streamfusion/core/relay";

import {
  booleanAt,
  cursorFrom,
  dataFrom,
  firstIdentifier,
  firstNumber,
  firstNumberOrNull,
  firstRecordAt,
  firstString,
  hasKey,
  recordAt,
  stringArrayAt,
  stringAt,
  type JsonRecord
} from "./kick-official-json";

type KickStream = SignedOutTopStreamsBody["streams"][number];
type KickCategory = SignedOutCategoriesBody["categories"][number];
type KickChannel = SignedOutSearchBody["channels"][number];

export function topStreamsBody(payload: unknown): SignedOutTopStreamsBody {
  const cursor = cursorFrom(payload);
  const body: SignedOutTopStreamsBody = {
    platform: "kick",
    streams: dataFrom(payload).map(toStream)
  };
  return cursor === null ? body : { ...body, cursor };
}

export function categoriesBody(payload: unknown): SignedOutCategoriesBody {
  const cursor = cursorFrom(payload);
  const body: SignedOutCategoriesBody = {
    categories: dataFrom(payload).map(toCategory),
    platform: "kick"
  };
  return cursor === null ? body : { ...body, cursor };
}

export function searchBody(
  channelsPayload: unknown | null,
  categoriesPayload: unknown | null,
  query: string
): SignedOutSearchBody | null {
  if (channelsPayload === null || categoriesPayload === null) return null;
  return {
    categories: dataFrom(categoriesPayload).map(toCategory),
    channels: dataFrom(channelsPayload).map(toChannel),
    platform: "kick",
    query,
    streams: []
  };
}

export function firstCategory(
  payload: unknown
): SignedOutCategoriesBody["categories"][number] | null {
  const [category] = dataFrom(payload).map(toCategory);
  return category ?? null;
}

export function toStream(record: JsonRecord): KickStream {
  const channel = recordAt(record, "channel") ?? record;
  const user = recordAt(channel, "user") ?? channel;
  const category =
    recordAt(record, "category") ?? firstRecordAt(record, "categories");
  const categoryId = category === null ? "" : identifierFrom(category);
  const categoryName = category === null ? "" : stringAt(category, "name");
  return {
    channelAvatar: firstString(user, [
      "profile_pic",
      "profile_picture",
      "avatar"
    ]),
    channelDisplayName: firstString(user, ["username", "name", "slug"]),
    channelId: firstIdentifier(channel, ["id", "slug"]),
    channelName: firstString(channel, ["slug", "username", "name"]),
    id: firstIdentifier(record, ["id", "slug", "session_id"]),
    isLive: booleanAt(record, "is_live") || !hasKey(record, "is_live"),
    language: stringAt(record, "language"),
    platform: "kick",
    startedAt: null,
    tags: stringArrayAt(record, "tags"),
    thumbnailUrl: firstString(record, ["thumbnail_url", "thumbnail", "image"]),
    title: firstString(record, ["session_title", "title", "stream_title"]),
    viewerCount: firstNumber(record, ["viewer_count", "viewers"]),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

export function toCategory(record: JsonRecord): KickCategory {
  const viewerCount = firstNumberOrNull(record, ["viewer_count", "viewers"]);
  return {
    boxArtUrl: firstString(record, [
      "thumbnail_url",
      "thumbnail",
      "image",
      "banner_url"
    ]),
    id: firstIdentifier(record, ["id", "slug"]),
    name: stringAt(record, "name"),
    platform: "kick",
    ...(viewerCount === null ? {} : { viewerCount })
  };
}

function identifierFrom(record: JsonRecord): string {
  return firstIdentifier(record, ["id", "slug"]);
}

export function toChannel(record: JsonRecord): KickChannel {
  const user = recordAt(record, "user") ?? record;
  return {
    avatarUrl: firstString(user, ["profile_pic", "profile_picture", "avatar"]),
    displayName: firstString(user, ["username", "name", "slug"]),
    id: firstIdentifier(record, ["id", "slug"]),
    isLive: booleanAt(record, "is_live"),
    isPartner: booleanAt(record, "is_partner"),
    isVerified: booleanAt(record, "verified"),
    platform: "kick",
    username: firstString(record, ["slug", "username", "name"])
  };
}
