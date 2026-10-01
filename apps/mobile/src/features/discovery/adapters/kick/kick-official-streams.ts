import type { Stream } from "@streamfusion/core/content";

import { kickTags, kickVerified } from "../../utils/catalog-fields";
import { canonicalTimestamp } from "../../utils/helix-media";

export function mapKickOfficialStreams(value: unknown): readonly Stream[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : [];
  return rows.flatMap((row): Stream[] => {
    if (
      !isRecord(row) ||
      !isRecord(row.channel) ||
      !isRecord(row.broadcaster_user)
    ) {
      return [];
    }
    const channel = row.channel;
    const broadcaster = row.broadcaster_user;
    const id = identifier(row.id);
    const channelId = identifier(broadcaster.id) || identifier(channel.id);
    const channelName = stringField(channel.slug).trim();
    if (
      id === "" ||
      channelId === "" ||
      channelName === "" ||
      row.is_live === false
    ) {
      return [];
    }
    const category = isRecord(row.category) ? row.category : null;
    const categoryId = category === null ? "" : identifier(category.id);
    const categoryName = category === null ? "" : stringField(category.name);
    return [
      {
        channelAvatar: stringField(broadcaster.profile_picture),
        channelDisplayName: stringField(broadcaster.username) || channelName,
        channelId,
        channelName,
        id,
        isLive: true,
        language: stringField(row.language_code),
        platform: "kick",
        startedAt: canonicalTimestamp(stringField(row.started_at)) ?? null,
        tags: kickTags(row),
        thumbnailUrl: stringField(row.thumbnail),
        title: stringField(row.title),
        viewerCount:
          typeof row.viewer_count === "number" &&
          Number.isFinite(row.viewer_count) &&
          row.viewer_count >= 0
            ? row.viewer_count
            : 0,
        ...(kickVerified(row) ||
        kickVerified(channel) ||
        kickVerified(broadcaster)
          ? { channelIsVerified: true }
          : {}),
        ...(categoryId === "" || categoryName === ""
          ? {}
          : { categoryId, categoryName }),
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function identifier(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}
