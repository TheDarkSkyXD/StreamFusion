import type { Channel, Stream, Video } from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import type {
  ChannelPageOutcome,
  PlatformReadOutcome,
} from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";
import { kickTags, kickVerified } from "../../utils/catalog-fields";
import { readKickPublicChannelVideos } from "./kick-public-videos";
import {
  canonicalTimestamp,
  identifierField,
  numberField,
  stringField,
} from "../../utils/helix-media";
import {
  kickPublicChannelUrl,
  mapKickPublicChannel,
  mapKickPublicLive,
} from "./kick-public-catalog";

const KICK_CHANNELS = "https://api.kick.com/public/v1/channels";

export function createKickOfficialChannelReader(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
}) {
  return {
    async getChannel(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<ChannelPageOutcome> {
      if (read.signal?.aborted) return failed("cancelled");
      const accessToken = await input.readAccessToken();
      const slug = read.channel.username || read.channel.id;
      if (accessToken === null) {
        return kickPublicChannelPage(input.fetch, slug, read.signal);
      }
      try {
        const response = await input.fetch(
          `${KICK_CHANNELS}?slug[]=${encodeURIComponent(slug)}`,
          requestInit({ Authorization: `Bearer ${accessToken}` }, read.signal),
        );
        if (!response.ok) {
          return failed(response.status === 401 ? "auth-lost" : "kick-failed");
        }
        const row = kickRows(await response.json()).at(0);
        if (row === undefined) return failed("kick-failed");
        const channel = toChannel(row);
        return {
          cache: { kind: "miss" },
          channel,
          live: channel.isLive ? toLive(row, channel) : null,
          path: { kind: "direct", platform: "kick" },
          platform: "kick",
          status: "complete",
        };
      } catch {
        return failed(read.signal?.aborted ? "cancelled" : "kick-failed");
      }
    },
    async getChannelVideos(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Video>> {
      return readKickPublicChannelVideos({
        fetchImpl: input.fetch,
        slug: read.channel.username || read.channel.id,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
  };
}

function kickRows(value: unknown): readonly Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return rows.flatMap((row) =>
    typeof row === "object" && row !== null && !Array.isArray(row)
      ? [row as Record<string, unknown>]
      : [],
  );
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toChannel(record: Record<string, unknown>): Channel {
  const user = recordField(record, "user") ?? record;
  const stream = recordField(record, "stream") ?? recordField(record, "livestream");
  const bio = stringField(record, "channel_description") || stringField(record, "bio");
  const bannerUrl =
    stringField(record, "banner_picture") || stringField(record, "banner_url");
  return {
    avatarUrl:
      stringField(user, "profile_pic") || stringField(user, "profile_picture"),
    displayName:
      stringField(user, "username") || stringField(record, "slug"),
    followerCount: numberField(record, "followers_count"),
    id:
      identifierField(record, "broadcaster_user_id") ||
      identifierField(record, "id") ||
      stringField(record, "slug"),
    isLive:
      record.has_livestream === true ||
      record.is_live === true ||
      stream?.is_live === true,
    isPartner: record.is_partner === true,
    isVerified: kickVerified(record) || kickVerified(user),
    platform: "kick",
    username: stringField(record, "slug") || stringField(user, "username"),
    ...(bannerUrl === "" ? {} : { bannerUrl }),
    ...(bio === "" ? {} : { bio }),
  };
}

function toLive(record: Record<string, unknown>, channel: Channel): Stream {
  const stream = recordField(record, "stream") ?? recordField(record, "livestream") ?? record;
  const startedAt =
    canonicalTimestamp(stringField(stream, "start_time")) ??
    canonicalTimestamp(stringField(stream, "started_at"));
  return {
    channelAvatar: channel.avatarUrl,
    channelDisplayName: channel.displayName,
    channelId: channel.id,
    channelName: channel.username,
    id: identifierField(stream, "id") || channel.id,
    isLive: true,
    language: stringField(stream, "language"),
    platform: "kick",
    startedAt: startedAt ?? null,
    tags: kickTags(stream).length > 0 ? kickTags(stream) : kickTags(record),
    thumbnailUrl:
      stringField(stream, "thumbnail_url") || stringField(stream, "thumbnail"),
    title:
      stringField(stream, "session_title") ||
      stringField(stream, "title") ||
      channel.displayName,
    viewerCount: numberField(stream, "viewer_count"),
    ...(channel.isVerified || channel.isPartner
      ? { channelIsVerified: true }
      : {}),
  };
}

function failed(code: string): ChannelPageOutcome {
  return {
    cache: { kind: "miss" },
    channel: null,
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    live: null,
    path:
      code === "auth-lost" || code === "signed-out-login-required"
        ? {
            kind: "unavailable",
            platform: "kick",
            reason: code === "auth-lost" ? "auth-lost" : "signed-out-login-required",
          }
        : { kind: "direct", platform: "kick" },
    platform: "kick",
    status: "failed",
  };
}

async function kickPublicChannelPage(
  fetchImpl: typeof globalThis.fetch,
  slug: string,
  signal?: AbortSignal,
): Promise<ChannelPageOutcome> {
  try {
    const response = await fetchImpl(
      kickPublicChannelUrl(slug),
      requestInit({ Accept: "application/json" }, signal),
    );
    if (!response.ok) return failed("kick-failed");
    const payload: unknown = await response.json();
    const channel = mapKickPublicChannel(payload);
    if (channel === null) return failed("kick-failed");
    return {
      cache: { kind: "miss" },
      channel,
      live: channel.isLive ? mapKickPublicLive(payload, channel) : null,
      path: { kind: "guest", platform: "kick" },
      platform: "kick",
      status: "complete",
    };
  } catch {
    return failed(signal?.aborted ? "cancelled" : "kick-failed");
  }
}
