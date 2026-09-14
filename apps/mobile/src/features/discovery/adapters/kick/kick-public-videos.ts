import {
  toSerializedTimestamp,
  type SerializedTimestamp,
  type Video,
} from "@streamfusion/core/content";

import type {
  PlatformReadOutcome,
  PlatformReadPath,
} from "../../capabilities/platform-reads";
import {
  canonicalTimestamp,
  identifierField,
  numberField,
  stringField,
} from "../../utils/helix-media";
import { requestInit } from "../../utils/optional";
import { KICK_PUBLIC_ACCEPT } from "./kick-public-catalog";

const FALLBACK_TIMESTAMP = toSerializedTimestamp("1970-01-01T00:00:00.000Z");

export function kickPublicChannelVideosUrl(slug: string): string {
  return `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/videos?limit=20`;
}

export async function readKickPublicChannelVideos(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly slug: string;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<Video>> {
  if (input.signal?.aborted) return failed("cancelled");
  try {
    const response = await input.fetchImpl(
      kickPublicChannelVideosUrl(input.slug),
      requestInit(KICK_PUBLIC_ACCEPT, input.signal),
    );
    if (!response.ok) {
      return failed(response.status === 401 ? "auth-lost" : "kick-failed");
    }
    return {
      cache: { kind: "miss" },
      items: mapKickPublicVideos(await response.json(), input.slug),
      path: { kind: "guest", platform: "kick" },
      platform: "kick",
      status: "complete",
    };
  } catch {
    return failed(input.signal?.aborted ? "cancelled" : "kick-failed");
  }
}

export function mapKickPublicVideos(
  value: unknown,
  slug: string,
): readonly Video[] {
  return records(value).flatMap((record) => {
    const video = videoFromRecord(record, slug);
    return video === undefined ? [] : [video];
  });
}

function videoFromRecord(
  record: Record<string, unknown>,
  slug: string,
): Video | undefined {
  if (droppedPublicVideo(record)) return undefined;
  const id = identifierField(record, "id");
  const title =
    stringField(record, "session_title") ||
    stringField(record, "title") ||
    slug;
  if (id === "" || title === "") return undefined;
  const source = stringField(record, "source");
  const durationMs = numberField(record, "duration");
  const published =
    stringField(record, "created_at") ||
    stringField(record, "start_time") ||
    "1970-01-01T00:00:00.000Z";
  return {
    channelAvatar: "",
    channelDisplayName: slug,
    channelId: slug,
    channelName: slug,
    duration: Math.max(0, Math.floor(durationMs / 1000)),
    id,
    platform: "kick",
    publishedAt: mediaTimestamp(published),
    thumbnailUrl: thumbnailUrl(record),
    title,
    type: "archive",
    url: source || `https://kick.com/${slug}`,
    viewCount: numberField(record, "views") || numberField(record, "viewers"),
  };
}

function droppedPublicVideo(record: Record<string, unknown>): boolean {
  if (record.deleted_at) return true;
  const video = objectField(record, "video");
  if (video === undefined) return false;
  if (video.deleted_at) return true;
  return video.is_pruned === true || video.is_private === true;
}

function thumbnailUrl(record: Record<string, unknown>): string {
  return (
    stringField(objectField(record, "thumbnail") ?? {}, "src") ||
    stringField(record, "thumbnail")
  );
}

function mediaTimestamp(value: string): SerializedTimestamp {
  return canonicalTimestamp(value) ?? FALLBACK_TIMESTAMP;
}

function failed(code: string): PlatformReadOutcome<Video> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path: failedPath(code),
    platform: "kick",
    status: "failed",
  };
}

function failedPath(code: string): PlatformReadPath {
  if (code === "cancelled") {
    return { kind: "unavailable", platform: "kick", reason: "cancelled" };
  }
  return { kind: "guest", platform: "kick" };
}

function records(value: unknown): readonly Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : [];
  return rows.flatMap((row) => (isRecord(row) ? [row] : []));
}

function objectField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
