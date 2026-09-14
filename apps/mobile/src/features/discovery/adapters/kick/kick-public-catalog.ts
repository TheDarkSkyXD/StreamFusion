import type { Category, Channel, Stream } from "@streamfusion/core/content";

export const KICK_PUBLIC_ACCEPT = { Accept: "application/json" } as const;
export const KICK_FEATURED_LIVESTREAMS =
  "https://kick.com/stream/featured-livestreams/en";
export const KICK_PUBLIC_LIVESTREAMS = "https://kick.com/stream/livestreams/en";
export const KICK_PUBLIC_SUBCATEGORIES = "https://kick.com/api/v1/subcategories";

export function kickPublicChannelUrl(slug: string): string {
  return `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`;
}

export function mapKickPublicStreams(value: unknown): readonly Stream[] {
  return records(value).flatMap((record) => {
    const channel = objectField(record, "channel") ?? record;
    const user = objectField(channel, "user") ?? channel;
    const id = identifier(record, "id");
    const channelName =
      stringField(channel, "slug") || stringField(record, "broadcaster_username");
    if (id === "" || channelName === "") return [];
    const category = firstCategory(record);
    return [
      {
        channelAvatar:
          stringField(user, "profilepic") ||
          stringField(user, "profile_pic") ||
          stringField(user, "profile_picture"),
        channelDisplayName:
          stringField(user, "username") || channelName,
        channelId: identifier(channel, "id") || identifier(record, "channel_id"),
        channelName,
        id,
        isLive: record.is_live !== false,
        language: stringField(record, "language"),
        platform: "kick" as const,
        startedAt: null,
        tags: [],
        thumbnailUrl: thumbnailUrl(record),
        title:
          stringField(record, "session_title") || stringField(record, "title"),
        viewerCount: Math.max(
          numberField(record, "viewer_count"),
          numberField(record, "viewers"),
        ),
        ...(category === null
          ? {}
          : { categoryId: category.id, categoryName: category.name }),
      },
    ];
  });
}

export function mapKickPublicCategories(value: unknown): readonly Category[] {
  return records(value).flatMap((record) => {
    const id = identifier(record, "id");
    const name = stringField(record, "name");
    if (id === "" || name === "") return [];
    const banner = objectField(record, "banner");
    return [
      {
        boxArtUrl:
          (banner === null ? "" : stringField(banner, "url")) ||
          stringField(record, "banner") ||
          stringField(record, "thumbnail"),
        id,
        name,
        platform: "kick" as const,
        viewerCount: numberField(record, "viewers"),
      },
    ];
  });
}

export function mapKickPublicChannel(value: unknown): Channel | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const user = objectField(record, "user") ?? record;
  const username =
    stringField(record, "slug") || stringField(user, "username");
  const id =
    identifier(record, "id") ||
    identifier(record, "user_id") ||
    username;
  if (id === "" || username === "") return null;
  const livestream =
    objectField(record, "livestream") ?? objectField(record, "stream");
  const bio = stringField(user, "bio") || stringField(record, "bio");
  return {
    avatarUrl:
      stringField(user, "profilepic") ||
      stringField(user, "profile_pic") ||
      stringField(user, "profile_picture"),
    displayName: stringField(user, "username") || username,
    id,
    isLive: livestream?.is_live === true || record.is_live === true,
    isPartner: record.is_affiliate === true || record.is_partner === true,
    isVerified: user.verified === true || record.verified === true,
    platform: "kick",
    username,
    ...(bio === "" ? {} : { bio }),
  };
}

export function mapKickPublicLive(
  value: unknown,
  channel: Channel,
): Stream | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const livestream =
    objectField(record, "livestream") ?? objectField(record, "stream");
  if (livestream === null && record.is_live !== true) return null;
  const live = livestream ?? record;
  const category = firstCategory(record) ?? firstCategory(live);
  return {
    channelAvatar: channel.avatarUrl,
    channelDisplayName: channel.displayName,
    channelId: channel.id,
    channelName: channel.username,
    id: identifier(live, "id") || channel.id,
    isLive: true,
    language: stringField(live, "language") || stringField(record, "language"),
    platform: "kick",
    startedAt: null,
    tags: [],
    thumbnailUrl: thumbnailUrl(live) || thumbnailUrl(record),
    title:
      stringField(live, "session_title") ||
      stringField(live, "title") ||
      channel.displayName,
    viewerCount: Math.max(
      numberField(live, "viewer_count"),
      numberField(live, "viewers"),
    ),
    ...(category === null
      ? {}
      : { categoryId: category.id, categoryName: category.name }),
  };
}

function firstCategory(
  record: Record<string, unknown>,
): { readonly id: string; readonly name: string } | null {
  const rows = Array.isArray(record.categories) ? record.categories : [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const category = row as Record<string, unknown>;
    const id = identifier(category, "id");
    const name = stringField(category, "name");
    if (id !== "" && name !== "") return { id, name };
  }
  return null;
}

function thumbnailUrl(record: Record<string, unknown>): string {
  const thumbnail = objectField(record, "thumbnail");
  if (thumbnail !== null) {
    return stringField(thumbnail, "src") || stringField(thumbnail, "url");
  }
  const value = record.thumbnail;
  return typeof value === "string" ? value : stringField(record, "thumbnail_url");
}

function records(value: unknown): readonly Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function objectField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function identifier(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? `${value}` : "";
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
