import type {
  SignedOutCategoriesBody,
  SignedOutCategoryClipsBody,
  SignedOutCategoryVideosBody,
  SignedOutSearchBody,
  SignedOutTopStreamsBody
} from "@streamfusion/core/relay";

import {
  booleanAt,
  cursorFrom,
  dataFrom,
  firstString,
  helixDurationSeconds,
  helixTimestamp,
  identifierAt,
  nonNegativeNumberAt,
  stringArrayAt,
  stringAt,
  type JsonRecord
} from "./twitch-helix-json";

type TwitchStream = SignedOutTopStreamsBody["streams"][number];
type TwitchCategory = SignedOutCategoriesBody["categories"][number];
type TwitchChannel = SignedOutSearchBody["channels"][number];
type TwitchClip = Extract<
  SignedOutCategoryClipsBody,
  { readonly kind: "available" }
>["clips"][number];
type TwitchVideo = Extract<
  SignedOutCategoryVideosBody,
  { readonly kind: "available" }
>["videos"][number];

export function topStreamsBody(payload: unknown): SignedOutTopStreamsBody {
  const cursor = cursorFrom(payload);
  const body: SignedOutTopStreamsBody = {
    platform: "twitch",
    streams: dataFrom(payload).map(toStream)
  };
  return cursor === null ? body : { ...body, cursor };
}

export function categoriesBody(payload: unknown): SignedOutCategoriesBody {
  const cursor = cursorFrom(payload);
  const body: SignedOutCategoriesBody = {
    categories: dataFrom(payload).map(toCategory),
    platform: "twitch"
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
    platform: "twitch",
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

export function toStream(record: JsonRecord): TwitchStream {
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  return {
    channelAvatar: "",
    channelDisplayName: firstString(record, ["user_name", "user_login"]),
    channelId: identifierAt(record, "user_id"),
    channelName: firstString(record, ["user_login", "user_name"]),
    id: identifierAt(record, "id"),
    isLive: stringAt(record, "type") === "live",
    language: stringAt(record, "language"),
    platform: "twitch",
    startedAt: null,
    tags: stringArrayAt(record, "tags"),
    thumbnailUrl: stringAt(record, "thumbnail_url")
      .replaceAll("{width}", "640")
      .replaceAll("{height}", "360"),
    title: stringAt(record, "title"),
    viewerCount: nonNegativeNumberAt(record, "viewer_count"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

export function toCategory(record: JsonRecord): TwitchCategory {
  return {
    boxArtUrl: stringAt(record, "box_art_url")
      .replaceAll("{width}", "285")
      .replaceAll("{height}", "380"),
    id: identifierAt(record, "id"),
    name: stringAt(record, "name"),
    platform: "twitch"
  };
}

export function toChannel(record: JsonRecord): TwitchChannel {
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  return {
    avatarUrl: stringAt(record, "thumbnail_url"),
    displayName: firstString(record, ["display_name", "broadcaster_login"]),
    id: identifierAt(record, "id"),
    isLive: booleanAt(record, "is_live"),
    isPartner: stringAt(record, "broadcaster_type") === "partner",
    isVerified: false,
    platform: "twitch",
    username: stringAt(record, "broadcaster_login"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

export function toClip(record: JsonRecord): TwitchClip | null {
  const createdAt = helixTimestamp(stringAt(record, "created_at"));
  const id = identifierAt(record, "id");
  if (createdAt === null || id === "") return null;
  const categoryId = stringAt(record, "game_id");
  return {
    channelAvatar: "",
    channelDisplayName: stringAt(record, "broadcaster_name"),
    channelId: identifierAt(record, "broadcaster_id"),
    channelName: stringAt(record, "broadcaster_name"),
    clipUrl: firstString(record, ["url", "embed_url"]),
    createdAt,
    creatorName: stringAt(record, "creator_name"),
    duration: nonNegativeNumberAt(record, "duration"),
    id,
    platform: "twitch",
    thumbnailUrl: stringAt(record, "thumbnail_url"),
    title: stringAt(record, "title"),
    viewCount: nonNegativeNumberAt(record, "view_count"),
    ...(categoryId === "" ? {} : { categoryId })
  };
}

export function toVideo(record: JsonRecord): TwitchVideo | null {
  const publishedAt = helixTimestamp(
    firstString(record, ["published_at", "created_at"])
  );
  const id = identifierAt(record, "id");
  const type = stringAt(record, "type");
  if (
    publishedAt === null ||
    id === "" ||
    (type !== "archive" && type !== "highlight" && type !== "upload")
  ) {
    return null;
  }
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  return {
    channelAvatar: "",
    channelDisplayName: firstString(record, ["user_name", "user_login"]),
    channelId: identifierAt(record, "user_id"),
    channelName: firstString(record, ["user_login", "user_name"]),
    duration: helixDurationSeconds(stringAt(record, "duration")),
    id,
    platform: "twitch",
    publishedAt,
    thumbnailUrl: stringAt(record, "thumbnail_url")
      .replaceAll("%{width}", "640")
      .replaceAll("%{height}", "360")
      .replaceAll("{width}", "640")
      .replaceAll("{height}", "360"),
    title: stringAt(record, "title"),
    type,
    url: stringAt(record, "url"),
    viewCount: nonNegativeNumberAt(record, "view_count"),
    ...(stringAt(record, "description") === ""
      ? {}
      : { description: stringAt(record, "description") }),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}
