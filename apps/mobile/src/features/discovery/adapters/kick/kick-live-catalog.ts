import type { Channel } from "@streamfusion/core/content";

import type {
  LiveStreamCatalog,
  LiveStreamCatalogEntry,
  LiveStreamCatalogRead,
} from "../../capabilities/live-stream-catalog";
import {
  kickVerified,
  objectField,
  stringList,
} from "../../utils/catalog-fields";
import {
  canonicalTimestamp,
  identifierField,
  numberField,
  stringField,
} from "../../utils/helix-media";
import { requestInit } from "../../utils/optional";

const DIRECTORY_URL = "https://api.kick.com/private/v1/livestreams";
const CACHE_TTL_MS = 30_000;

export function createKickLiveCatalog(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly nowEpochMs?: () => number;
}): LiveStreamCatalog {
  const nowEpochMs = input.nowEpochMs ?? Date.now;
  let cached: {
    readonly read: Extract<LiveStreamCatalogRead, { kind: "ready" }>;
    readonly expiresAt: number;
  } | null = null;
  return {
    async read({ signal }) {
      if (signal?.aborted) return cancelled();
      if (cached && nowEpochMs() < cached.expiresAt) return cached.read;
      try {
        const response = await input.fetch(
          DIRECTORY_URL,
          requestInit({ Accept: "application/json" }, signal),
        );
        if (signal?.aborted) return cancelled();
        if (!response.ok) {
          return {
            kind: "unavailable",
            failure: { kind: "provider-rejected", status: response.status },
          };
        }
        const payload: unknown = await response.json();
        if (signal?.aborted) return cancelled();
        const entries = parseDirectory(payload);
        if (entries === null) {
          return { kind: "unavailable", failure: { kind: "invalid-response" } };
        }
        const read = { kind: "ready", entries } satisfies LiveStreamCatalogRead;
        cached = { read, expiresAt: nowEpochMs() + CACHE_TTL_MS };
        return read;
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return cancelled();
        }
        return {
          kind: "unavailable",
          failure: {
            kind: error instanceof SyntaxError ? "invalid-response" : "offline",
          },
        };
      }
    },
  };
}

function parseDirectory(
  value: unknown,
): readonly LiveStreamCatalogEntry[] | null {
  if (!isRecord(value)) return null;
  const data = objectField(value, "data");
  if (data === null || !Array.isArray(data.livestreams)) return null;
  const entries = data.livestreams.flatMap((row: unknown) => {
    const entry = parseEntry(row);
    return entry === null ? [] : [entry];
  });
  if (data.livestreams.length > 0 && entries.length === 0) return null;
  return entries.sort(
    (left, right) => right.stream.viewerCount - left.stream.viewerCount,
  );
}

function parseEntry(value: unknown): LiveStreamCatalogEntry | null {
  if (!isRecord(value)) return null;
  const streamer = objectField(value, "streamer");
  const channelRecord =
    streamer === null ? null : objectField(streamer, "channel");
  const user = streamer === null ? null : objectField(streamer, "user");
  const metadata = objectField(value, "metadata");
  if (channelRecord === null || user === null || metadata === null) return null;
  const id = identifierField(value, "id");
  const channelId =
    identifierField(channelRecord, "id") || identifierField(user, "id");
  const slug = stringField(channelRecord, "slug");
  if (id === "" || channelId === "" || slug === "") return null;
  const category = objectField(metadata, "category");
  const categoryId = category === null ? "" : identifierField(category, "id");
  const categoryName = category === null ? "" : stringField(category, "name");
  const title = stringField(metadata, "title");
  const channel: Channel = {
    avatarUrl: stringField(user, "profile_picture"),
    displayName: stringField(user, "username") || slug,
    id: channelId,
    isLive: true,
    isPartner:
      channelRecord.is_partner === true || channelRecord.is_affiliate === true,
    isVerified:
      kickVerified(value) || kickVerified(user) || kickVerified(channelRecord),
    platform: "kick",
    username: slug,
    ...(stringField(channelRecord, "banner_picture") === ""
      ? {}
      : { bannerUrl: stringField(channelRecord, "banner_picture") }),
    ...(stringField(channelRecord, "description") === ""
      ? {}
      : { bio: stringField(channelRecord, "description") }),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName }),
    ...(title === "" ? {} : { lastStreamTitle: title }),
  };
  const customTags = stringList(value.custom_tags);
  const playbackUrl = stringField(value, "playback_url");
  return {
    channel,
    playbackUrl: playbackUrl === "" ? null : playbackUrl,
    stream: {
      channelAvatar: channel.avatarUrl,
      channelDisplayName: channel.displayName,
      channelId,
      channelIsVerified: channel.isVerified,
      channelName: slug,
      id,
      isLive: true,
      isMature: metadata.has_mature_content === true,
      language: stringField(metadata, "language"),
      platform: "kick",
      startedAt: canonicalTimestamp(stringField(value, "started_at")) ?? null,
      tags: customTags.length > 0 ? customTags : stringList(value.tags),
      thumbnailUrl: stringField(value, "thumbnail_url"),
      title,
      viewerCount: numberField(value, "viewers_count"),
      ...(categoryId === "" ? {} : { categoryId }),
      ...(categoryName === "" ? {} : { categoryName }),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cancelled(): LiveStreamCatalogRead {
  return { kind: "unavailable", failure: { kind: "cancelled" } };
}
