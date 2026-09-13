import type { Category, Channel, Stream } from "@streamfusion/core/content";

export function helixStreams(value: unknown): readonly Stream[] {
  return helixRows(value).flatMap((record) => {
    const id = stringField(record, "id");
    if (id === "") return [];
    return [
      {
        channelAvatar: "",
        channelDisplayName: stringField(record, "user_name"),
        channelId: stringField(record, "user_id"),
        channelName: stringField(record, "user_login"),
        id,
        isLive: stringField(record, "type") === "live",
        language: stringField(record, "language"),
        platform: "twitch" as const,
        startedAt: null,
        tags: [],
        thumbnailUrl: stringField(record, "thumbnail_url")
          .replaceAll("{width}", "640")
          .replaceAll("{height}", "360"),
        title: stringField(record, "title"),
        viewerCount:
          typeof record.viewer_count === "number" && record.viewer_count >= 0
            ? record.viewer_count
            : 0,
      },
    ];
  });
}

export function helixCategories(value: unknown): readonly Category[] {
  return helixRows(value).flatMap((record) => {
    const id = stringField(record, "id");
    if (id === "") return [];
    return [
      {
        boxArtUrl: stringField(record, "box_art_url")
          .replaceAll("{width}", "285")
          .replaceAll("{height}", "380"),
        id,
        name: stringField(record, "name"),
        platform: "twitch" as const,
      },
    ];
  });
}

export function helixChannels(value: unknown): readonly Channel[] {
  return helixRows(value).flatMap((record) => {
    const id = stringField(record, "id");
    if (id === "") return [];
    const categoryId = stringField(record, "game_id");
    const categoryName = stringField(record, "game_name");
    return [
      {
        avatarUrl: stringField(record, "thumbnail_url"),
        displayName:
          stringField(record, "display_name") ||
          stringField(record, "broadcaster_login"),
        id,
        isLive: record.is_live === true,
        isPartner: stringField(record, "broadcaster_type") === "partner",
        isVerified: false,
        platform: "twitch" as const,
        username: stringField(record, "broadcaster_login"),
        ...(categoryId === "" ? {} : { categoryId }),
        ...(categoryName === "" ? {} : { categoryName }),
      },
    ];
  });
}

function helixRows(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return [];
  }
  const data = (value as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
