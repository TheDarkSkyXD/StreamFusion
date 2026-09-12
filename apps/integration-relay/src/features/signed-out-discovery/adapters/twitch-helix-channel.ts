import type {
  SignedOutChannelBody,
  SignedOutClipsBody,
  SignedOutVideosBody
} from "@streamfusion/core/relay";

import type { ChannelLookup } from "../capabilities/discovery-catalog";
import {
  cursorFrom,
  dataFrom,
  firstString,
  helixDurationSeconds,
  identifierAt,
  nonNegativeNumberAt,
  queryParams,
  requiredTimestamp,
  stringAt,
  timestampAt
} from "./catalog-mappers";

type HelixGet = (path: string) => Promise<unknown | null>;

export function createTwitchChannelReads(get: HelixGet) {
  return {
    async channel(lookup: ChannelLookup): Promise<SignedOutChannelBody | null> {
      const user = await readTwitchUser(get, lookup);
      if (user === null) return null;
      const userId = identifierAt(user, "id");
      const [channelPayload, streamPayload] = await Promise.all([
        get(`/channels?broadcaster_id=${encodeURIComponent(userId)}`),
        get(`/streams?user_id=${encodeURIComponent(userId)}`)
      ]);
      const channelRow = dataFrom(channelPayload ?? {}).at(0) ?? {};
      const liveRow = dataFrom(streamPayload ?? {}).at(0);
      const channel = toTwitchChannel(user, channelRow, liveRow !== undefined);
      return {
        channel,
        live:
          liveRow === undefined ? null : toTwitchLiveStream(liveRow, channel),
        platform: "twitch"
      };
    },
    async videos(lookup: ChannelLookup): Promise<SignedOutVideosBody | null> {
      const user = await readTwitchUser(get, lookup);
      if (user === null) return null;
      const userId = identifierAt(user, "id");
      const payload = await get(
        `/videos?${queryParams({ first: "20", user_id: userId })}`
      );
      if (payload === null) return null;
      const cursor = cursorFrom(payload);
      const body: SignedOutVideosBody = {
        channelId: userId,
        platform: "twitch",
        support: "available",
        videos: dataFrom(payload).map((row) => toTwitchVideo(row, user))
      };
      return cursor === undefined ? body : { ...body, cursor };
    },
    async clips(lookup: ChannelLookup): Promise<SignedOutClipsBody | null> {
      const user = await readTwitchUser(get, lookup);
      if (user === null) return null;
      const userId = identifierAt(user, "id");
      const payload = await get(
        `/clips?${queryParams({ broadcaster_id: userId, first: "20" })}`
      );
      if (payload === null) return null;
      const cursor = cursorFrom(payload);
      const body: SignedOutClipsBody = {
        channelId: userId,
        clips: dataFrom(payload).map((row) => toTwitchClip(row, user)),
        platform: "twitch",
        support: "available"
      };
      return cursor === undefined ? body : { ...body, cursor };
    }
  };
}

async function readTwitchUser(
  get: HelixGet,
  lookup: ChannelLookup
): Promise<Record<string, unknown> | null> {
  const query =
    lookup.id !== undefined && lookup.id !== ""
      ? queryParams({ id: lookup.id })
      : lookup.login !== undefined && lookup.login !== ""
        ? queryParams({ login: lookup.login })
        : "";
  if (query === "") return null;
  const payload = await get(`/users?${query}`);
  return dataFrom(payload ?? {}).at(0) ?? null;
}

function toTwitchChannel(
  user: Record<string, unknown>,
  channel: Record<string, unknown>,
  isLive: boolean
): SignedOutChannelBody["channel"] {
  const createdAt = timestampAt(user, "created_at");
  const categoryId = stringAt(channel, "game_id");
  const categoryName = stringAt(channel, "game_name");
  const bio = firstString(user, ["description"]) || stringAt(channel, "title");
  const bannerUrl = stringAt(user, "offline_image_url");
  return {
    avatarUrl: stringAt(user, "profile_image_url"),
    displayName: firstString(user, ["display_name", "login"]),
    id: identifierAt(user, "id"),
    isLive,
    isPartner: stringAt(user, "broadcaster_type") === "partner",
    isVerified: stringAt(user, "broadcaster_type") !== "",
    platform: "twitch",
    username: firstString(user, ["login", "display_name"]),
    viewCount: nonNegativeNumberAt(user, "view_count"),
    ...(bannerUrl === "" ? {} : { bannerUrl }),
    ...(bio === "" ? {} : { bio }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName }),
    ...(stringAt(channel, "title") === ""
      ? {}
      : { lastStreamTitle: stringAt(channel, "title") })
  };
}

function toTwitchLiveStream(
  record: Record<string, unknown>,
  channel: SignedOutChannelBody["channel"]
): NonNullable<SignedOutChannelBody["live"]> {
  const startedAt = timestampAt(record, "started_at");
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  return {
    channelAvatar: channel.avatarUrl,
    channelDisplayName: channel.displayName,
    channelId: channel.id,
    channelName: channel.username,
    id: identifierAt(record, "id"),
    isLive: true,
    language: stringAt(record, "language"),
    platform: "twitch",
    startedAt: startedAt ?? null,
    tags: [],
    thumbnailUrl: stringAt(record, "thumbnail_url")
      .replaceAll("{width}", "640")
      .replaceAll("{height}", "360"),
    title:
      stringAt(record, "title") ||
      channel.lastStreamTitle ||
      channel.displayName,
    viewerCount: nonNegativeNumberAt(record, "viewer_count"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

function toTwitchVideo(
  record: Record<string, unknown>,
  user: Record<string, unknown>
): SignedOutVideosBody["videos"][number] {
  const publishedAt = requiredTimestamp(
    timestampAt(record, "published_at") ?? timestampAt(record, "created_at")
  );
  const type = stringAt(record, "type");
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  const description = stringAt(record, "description");
  return {
    channelAvatar: stringAt(user, "profile_image_url"),
    channelDisplayName: firstString(user, ["display_name", "login"]),
    channelId: identifierAt(user, "id"),
    channelName: firstString(user, ["login", "display_name"]),
    duration: helixDurationSeconds(stringAt(record, "duration")),
    id: identifierAt(record, "id"),
    platform: "twitch",
    publishedAt,
    thumbnailUrl: stringAt(record, "thumbnail_url")
      .replaceAll("%{width}", "320")
      .replaceAll("%{height}", "180")
      .replaceAll("{width}", "320")
      .replaceAll("{height}", "180"),
    title: stringAt(record, "title"),
    type: type === "highlight" || type === "upload" ? type : "archive",
    url: stringAt(record, "url"),
    viewCount: nonNegativeNumberAt(record, "view_count"),
    ...(description === "" ? {} : { description }),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

function toTwitchClip(
  record: Record<string, unknown>,
  user: Record<string, unknown>
): SignedOutClipsBody["clips"][number] {
  const createdAt = requiredTimestamp(timestampAt(record, "created_at"));
  const categoryId = stringAt(record, "game_id");
  return {
    channelAvatar: stringAt(user, "profile_image_url"),
    channelDisplayName: firstString(user, ["display_name", "login"]),
    channelId: identifierAt(user, "id"),
    channelName: firstString(user, ["login", "display_name"]),
    clipUrl: stringAt(record, "url"),
    createdAt,
    creatorName: firstString(record, ["creator_name", "creator_id"]),
    duration: nonNegativeNumberAt(record, "duration"),
    id: identifierAt(record, "id"),
    platform: "twitch",
    thumbnailUrl: stringAt(record, "thumbnail_url"),
    title: stringAt(record, "title"),
    viewCount: nonNegativeNumberAt(record, "view_count"),
    ...(categoryId === "" ? {} : { categoryId })
  };
}
