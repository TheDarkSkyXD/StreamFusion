import {
  toSerializedTimestamp,
  type Channel,
  type Clip,
  type Stream,
  type Video,
} from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import type {
  ChannelPageOutcome,
  PlatformReadOutcome,
} from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";
import {
  canonicalTimestamp,
  helixDurationSeconds,
  helixRows,
  identifierField,
  numberField,
  stringField,
} from "../../utils/helix-media";

const HELIX = "https://api.twitch.tv/helix";

export function createTwitchHelixChannelReader(input: {
  readonly clientId: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
}) {
  return {
    async getChannel(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<ChannelPageOutcome> {
      const user = await helixUser(input, read.channel, read.signal);
      if (user.kind === "failed") return failedPage(user.code);
      const userId = identifierField(user.row, "id");
      const [channelPayload, streamPayload] = await Promise.all([
        helixJson(input, `/channels?broadcaster_id=${encodeURIComponent(userId)}`, read.signal),
        helixJson(input, `/streams?user_id=${encodeURIComponent(userId)}`, read.signal),
      ]);
      if (channelPayload.kind === "failed") return failedPage(channelPayload.code);
      if (streamPayload.kind === "failed") return failedPage(streamPayload.code);
      const channelRow = helixRows(channelPayload.value).at(0) ?? {};
      const liveRow = helixRows(streamPayload.value).at(0);
      const channel = toChannel(user.row, channelRow, liveRow !== undefined);
      return {
        cache: { kind: "miss" },
        channel,
        live: liveRow === undefined ? null : toLive(liveRow, channel),
        path: { kind: "direct", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      };
    },
    async getChannelVideos(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Video>> {
      const user = await helixUser(input, read.channel, read.signal);
      if (user.kind === "failed") return failedCollection(user.code);
      const payload = await helixJson(
        input,
        `/videos?user_id=${encodeURIComponent(identifierField(user.row, "id"))}&first=20`,
        read.signal,
      );
      if (payload.kind === "failed") return failedCollection(payload.code);
      return {
        cache: { kind: "miss" },
        items: helixRows(payload.value).map((row) => toVideo(row, user.row)),
        path: { kind: "direct", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      };
    },
    async getChannelClips(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Clip>> {
      const user = await helixUser(input, read.channel, read.signal);
      if (user.kind === "failed") return failedCollection(user.code);
      const payload = await helixJson(
        input,
        `/clips?broadcaster_id=${encodeURIComponent(identifierField(user.row, "id"))}&first=20`,
        read.signal,
      );
      if (payload.kind === "failed") return failedCollection(payload.code);
      return {
        cache: { kind: "miss" },
        items: helixRows(payload.value).map((row) => toClip(row, user.row)),
        path: { kind: "direct", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      };
    },
  };
}

async function helixUser(
  input: {
    readonly clientId: string | null;
    readonly fetch: typeof globalThis.fetch;
    readonly readAccessToken: () => Promise<string | null>;
  },
  channel: ChannelIdentity,
  signal?: AbortSignal,
): Promise<
  | { readonly kind: "ready"; readonly row: Record<string, unknown> }
  | { readonly kind: "failed"; readonly code: string }
> {
  const query =
    channel.id !== ""
      ? `id=${encodeURIComponent(channel.id)}`
      : `login=${encodeURIComponent(channel.username)}`;
  const payload = await helixJson(input, `/users?${query}`, signal);
  if (payload.kind === "failed") return payload;
  const row = helixRows(payload.value).at(0);
  return row === undefined
    ? { code: "twitch-failed", kind: "failed" }
    : { kind: "ready", row };
}

async function helixJson(
  input: {
    readonly clientId: string | null;
    readonly fetch: typeof globalThis.fetch;
    readonly readAccessToken: () => Promise<string | null>;
  },
  path: string,
  signal?: AbortSignal,
): Promise<
  | { readonly kind: "ready"; readonly value: unknown }
  | { readonly kind: "failed"; readonly code: string }
> {
  if (signal?.aborted) return { code: "cancelled", kind: "failed" };
  const accessToken = await input.readAccessToken();
  if (accessToken === null || input.clientId === null) {
    return { code: "signed-out-login-required", kind: "failed" };
  }
  try {
    const response = await input.fetch(
      `${HELIX}${path}`,
      requestInit(
        {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": input.clientId,
        },
        signal,
      ),
    );
    if (!response.ok) {
      return {
        code: response.status === 401 ? "auth-lost" : "twitch-failed",
        kind: "failed",
      };
    }
    return { kind: "ready", value: await response.json() };
  } catch {
    return { code: signal?.aborted ? "cancelled" : "twitch-failed", kind: "failed" };
  }
}

function toChannel(
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
    isVerified: stringField(user, "broadcaster_type") !== "",
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

function toLive(record: Record<string, unknown>, channel: Channel): Stream {
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
    tags: [],
    thumbnailUrl: stringField(record, "thumbnail_url")
      .replaceAll("{width}", "640")
      .replaceAll("{height}", "360"),
    title: stringField(record, "title") || channel.lastStreamTitle || channel.displayName,
    viewerCount: numberField(record, "viewer_count"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName }),
  };
}

function toVideo(record: Record<string, unknown>, user: Record<string, unknown>): Video {
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

function toClip(record: Record<string, unknown>, user: Record<string, unknown>): Clip {
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

function failedPage(code: string): ChannelPageOutcome {
  return {
    cache: { kind: "miss" },
    channel: null,
    error: {
      code,
      retry: code === "cancelled" ? "none" : "manual",
    },
    live: null,
    path:
      code === "auth-lost" || code === "signed-out-login-required"
        ? { kind: "unavailable", platform: "twitch", reason: code === "auth-lost" ? "auth-lost" : "signed-out-login-required" }
        : { kind: "direct", platform: "twitch" },
    platform: "twitch",
    status: "failed",
  };
}

function failedCollection<T>(code: string): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path:
      code === "auth-lost" || code === "signed-out-login-required"
        ? {
            kind: "unavailable",
            platform: "twitch",
            reason: code === "auth-lost" ? "auth-lost" : "signed-out-login-required",
          }
        : { kind: "direct", platform: "twitch" },
    platform: "twitch",
    status: "failed",
  };
}
