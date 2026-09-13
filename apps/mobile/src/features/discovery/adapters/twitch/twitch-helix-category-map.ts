import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import type { ClipTimeRange } from "@streamfusion/core/discovery";

export function helixCategories(value: unknown): readonly Category[] {
  return records(value).flatMap((record) => {
    const id = stringField(record, "id");
    return id === ""
      ? []
      : [
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

export function helixStreams(value: unknown): readonly Stream[] {
  return records(value).flatMap((record) => {
    const id = stringField(record, "id");
    return id === ""
      ? []
      : [
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
            viewerCount: numberField(record, "viewer_count"),
          },
        ];
  });
}

export function helixClips(value: unknown): readonly Clip[] {
  return records(value).flatMap((record) => {
    const createdAt = isoField(record, "created_at");
    const id = stringField(record, "id");
    return createdAt === null || id === ""
      ? []
      : [
          {
            channelAvatar: "",
            channelDisplayName: stringField(record, "broadcaster_name"),
            channelId: stringField(record, "broadcaster_id"),
            channelName: stringField(record, "broadcaster_name"),
            clipUrl: stringField(record, "url"),
            createdAt,
            creatorName: stringField(record, "creator_name"),
            duration: numberField(record, "duration"),
            id,
            platform: "twitch" as const,
            thumbnailUrl: stringField(record, "thumbnail_url"),
            title: stringField(record, "title"),
            viewCount: numberField(record, "view_count"),
          },
        ];
  });
}

export function helixVideos(value: unknown): readonly Video[] {
  return records(value).flatMap((record) => {
    const publishedAt = isoField(record, "published_at");
    const id = stringField(record, "id");
    const type = stringField(record, "type");
    if (
      publishedAt === null ||
      id === "" ||
      (type !== "archive" && type !== "highlight" && type !== "upload")
    ) {
      return [];
    }
    return [
      {
        channelAvatar: "",
        channelDisplayName: stringField(record, "user_name"),
        channelId: stringField(record, "user_id"),
        channelName: stringField(record, "user_login"),
        duration: helixDuration(stringField(record, "duration")),
        id,
        platform: "twitch" as const,
        publishedAt,
        thumbnailUrl: stringField(record, "thumbnail_url"),
        title: stringField(record, "title"),
        type,
        url: stringField(record, "url"),
        viewCount: numberField(record, "view_count"),
      },
    ];
  });
}

export function clipWindow(
  timeRange: ClipTimeRange,
): { readonly endedAt: string; readonly startedAt: string } | null {
  if (timeRange === "all") return null;
  const now = Date.now();
  const span =
    timeRange === "day"
      ? 86_400_000
      : timeRange === "week"
        ? 604_800_000
        : 2_592_000_000;
  return {
    endedAt: new Date(now).toISOString(),
    startedAt: new Date(now - span).toISOString(),
  };
}

function records(value: unknown): Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return [];
  }
  const data = (value as { data: unknown }).data;
  return Array.isArray(data)
    ? data.filter(
        (row): row is Record<string, unknown> =>
          typeof row === "object" && row !== null,
      )
    : [];
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function isoField(
  record: Record<string, unknown>,
  key: string,
): Video["publishedAt"] | null {
  const value = stringField(record, key);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString() as Video["publishedAt"];
}

function helixDuration(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (match === null) return 0;
  return (
    Number(match[1] ?? 0) * 3_600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}
