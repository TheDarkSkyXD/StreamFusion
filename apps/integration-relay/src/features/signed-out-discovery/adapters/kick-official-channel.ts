import type {
  SignedOutChannelBody,
  SignedOutClipsBody,
  SignedOutVideosBody
} from "@streamfusion/core/relay";

import type { ChannelLookup } from "../capabilities/discovery-catalog";
import {
  booleanAt,
  dataFrom,
  firstIdentifier,
  firstString,
  identifierAt,
  lookupChannelId,
  nonNegativeNumberAt,
  queryParams,
  recordAt,
  stringAt,
  timestampAt
} from "./catalog-mappers";

type KickGet = (path: string) => Promise<unknown | null>;

export function createKickChannelReads(get: KickGet) {
  return {
    async channel(lookup: ChannelLookup): Promise<SignedOutChannelBody | null> {
      const row = await readKickChannel(get, lookup);
      if (row === null) return null;
      const channel = toKickChannelDetail(row);
      return {
        channel,
        live: channel.isLive ? toKickLiveStream(row, channel) : null,
        platform: "kick"
      };
    },
    async videos(lookup: ChannelLookup): Promise<SignedOutVideosBody | null> {
      const channelId = lookupChannelId(lookup);
      if (channelId === "") return null;
      return {
        channelId,
        platform: "kick",
        support: "unsupported",
        videos: []
      };
    },
    async clips(lookup: ChannelLookup): Promise<SignedOutClipsBody | null> {
      const channelId = lookupChannelId(lookup);
      if (channelId === "") return null;
      return {
        channelId,
        clips: [],
        platform: "kick",
        support: "unsupported"
      };
    }
  };
}

async function readKickChannel(
  get: KickGet,
  lookup: ChannelLookup
): Promise<Record<string, unknown> | null> {
  const query =
    lookup.login !== undefined && lookup.login !== ""
      ? queryParams({ "slug[]": lookup.login })
      : lookup.id !== undefined && lookup.id !== ""
        ? queryParams({ "slug[]": lookup.id })
        : "";
  if (query === "") return null;
  const payload = await get(`/public/v1/channels?${query}`);
  return dataFrom(payload ?? {}).at(0) ?? null;
}

function toKickChannelDetail(
  record: Record<string, unknown>
): SignedOutChannelBody["channel"] {
  const user = recordAt(record, "user") ?? record;
  const stream = recordAt(record, "stream") ?? recordAt(record, "livestream");
  const category =
    recordAt(record, "category") ??
    (stream === null ? null : recordAt(stream, "category"));
  const createdAt = timestampAt(record, "created_at");
  const bannerUrl = firstString(record, [
    "banner_picture",
    "banner_url",
    "offline_banner_image"
  ]);
  const bio = firstString(record, [
    "channel_description",
    "bio",
    "description"
  ]);
  const categoryId = category === null ? "" : identifierAt(category, "id");
  const categoryName = category === null ? "" : stringAt(category, "name");
  return {
    avatarUrl: firstString(user, ["profile_pic", "profile_picture", "avatar"]),
    displayName: firstString(user, ["username", "name", "slug"]),
    followerCount: firstNumber(record, ["followers_count", "follower_count"]),
    id: firstIdentifier(record, ["broadcaster_user_id", "id", "slug"]),
    isLive:
      booleanAt(record, "has_livestream") ||
      booleanAt(record, "is_live") ||
      (stream !== null && booleanAt(stream, "is_live")),
    isPartner: booleanAt(record, "is_partner"),
    isVerified: booleanAt(record, "verified") || booleanAt(user, "verified"),
    platform: "kick",
    username: firstString(record, ["slug", "username", "name"]),
    ...(bannerUrl === "" ? {} : { bannerUrl }),
    ...(bio === "" ? {} : { bio }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName }),
    ...(firstString(record, ["stream_title", "session_title"]) === ""
      ? {}
      : {
          lastStreamTitle: firstString(record, [
            "stream_title",
            "session_title"
          ])
        })
  };
}

function toKickLiveStream(
  record: Record<string, unknown>,
  channel: SignedOutChannelBody["channel"]
): NonNullable<SignedOutChannelBody["live"]> {
  const stream =
    recordAt(record, "stream") ?? recordAt(record, "livestream") ?? record;
  const startedAt =
    timestampAt(stream, "start_time") ?? timestampAt(stream, "started_at");
  return {
    channelAvatar: channel.avatarUrl,
    channelDisplayName: channel.displayName,
    channelId: channel.id,
    channelName: channel.username,
    id: firstIdentifier(stream, ["id", "slug", "session_id"]) || channel.id,
    isLive: true,
    language: firstString(stream, ["language", "locale"]),
    platform: "kick",
    startedAt: startedAt ?? null,
    tags: [],
    thumbnailUrl: firstString(stream, [
      "thumbnail_url",
      "thumbnail",
      "preview"
    ]),
    title:
      firstString(stream, ["session_title", "title", "stream_title"]) ||
      channel.lastStreamTitle ||
      channel.displayName,
    viewerCount: firstNumber(stream, ["viewer_count", "viewers"]),
    ...(channel.categoryId === undefined
      ? {}
      : { categoryId: channel.categoryId }),
    ...(channel.categoryName === undefined
      ? {}
      : { categoryName: channel.categoryName })
  };
}

function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[]
): number {
  for (const key of keys) {
    const value = nonNegativeNumberAt(record, key);
    if (value > 0) return value;
  }
  return 0;
}
