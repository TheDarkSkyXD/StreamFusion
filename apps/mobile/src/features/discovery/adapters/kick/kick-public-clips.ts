import type { Clip } from "@streamfusion/core/content";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import {
  canonicalTimestamp,
  identifierField,
  numberField,
  stringField,
} from "../../utils/helix-media";
import { requestInit } from "../../utils/optional";
import { KICK_PUBLIC_ACCEPT } from "./kick-public-catalog";

export function kickPublicChannelClipsUrl(slug: string): string {
  return `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/clips?cursor=0&limit=20&sort=date`;
}

export async function readKickPublicChannelClips(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly slug: string;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<Clip>> {
  if (input.signal?.aborted) return failed("cancelled");
  try {
    const response = await input.fetchImpl(
      kickPublicChannelClipsUrl(input.slug),
      requestInit(KICK_PUBLIC_ACCEPT, input.signal),
    );
    if (!response.ok) return failed("kick-failed");
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.clips)) {
      return failed("kick-failed");
    }
    const cursor =
      typeof payload.nextCursor === "string" && payload.nextCursor !== ""
        ? payload.nextCursor
        : undefined;
    return {
      cache: { kind: "miss" },
      items: payload.clips.flatMap((value) => {
        const clip = isRecord(value) ? mapClip(value, input.slug) : undefined;
        return clip === undefined ? [] : [clip];
      }),
      path: { kind: "guest", platform: "kick" },
      platform: "kick",
      status: "complete",
      ...(cursor === undefined ? {} : { cursor }),
    };
  } catch {
    return failed(input.signal?.aborted ? "cancelled" : "kick-failed");
  }
}

function mapClip(
  record: Record<string, unknown>,
  slug: string,
): Clip | undefined {
  if (record.privacy !== undefined && record.privacy !== "public")
    return undefined;
  const id = identifierField(record, "id");
  const createdAt = canonicalTimestamp(stringField(record, "created_at"));
  if (id === "" || createdAt === undefined) return undefined;
  const channel = objectField(record, "channel");
  const category = objectField(record, "category");
  const creator = objectField(record, "creator");
  const channelName = stringField(channel, "slug") || slug;
  const publicUrl = `https://kick.com/${encodeURIComponent(channelName)}/clips/${encodeURIComponent(id)}`;
  const categoryId = identifierField(category, "id");
  const categoryName = stringField(category, "name");
  return {
    channelAvatar:
      stringField(channel, "profile_picture") ||
      stringField(channel, "profile_pic"),
    channelDisplayName: stringField(channel, "username") || channelName,
    channelId:
      identifierField(channel, "id") ||
      identifierField(record, "channel_id") ||
      slug,
    channelName,
    clipUrl: publicUrl,
    createdAt,
    creatorName:
      stringField(creator, "username") || stringField(creator, "slug"),
    duration: numberField(record, "duration"),
    id,
    platform: "kick",
    shareUrl: publicUrl,
    thumbnailUrl: stringField(record, "thumbnail_url"),
    title: stringField(record, "title") || channelName,
    viewCount:
      numberField(record, "views") || numberField(record, "view_count"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName }),
  };
}

function failed(code: "cancelled" | "kick-failed"): PlatformReadOutcome<Clip> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path:
      code === "cancelled"
        ? { kind: "unavailable", platform: "kick", reason: "cancelled" }
        : { kind: "guest", platform: "kick" },
    platform: "kick",
    status: "failed",
  };
}

function objectField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
