import type { SignedOutSearchBody } from "@streamfusion/core/relay";

type SearchChannel = SignedOutSearchBody["channels"][number];
type SearchVideo = SignedOutSearchBody["videos"][number];
type SearchClip = SignedOutSearchBody["clips"][number];
type JsonRecord = Record<string, unknown>;

const MEDIA_CHANNEL_LIMIT = 3;
const MEDIA_ITEM_LIMIT = 6;

export async function fetchTwitchSearchMedia(input: {
  readonly channels: readonly SearchChannel[];
  readonly get: (path: string) => Promise<unknown | null>;
}): Promise<{
  readonly videos: readonly SearchVideo[];
  readonly clips: readonly SearchClip[];
}> {
  const channels = input.channels.slice(0, MEDIA_CHANNEL_LIMIT);
  const pages = await Promise.all(
    channels.map(async (channel) => {
      const [videosPayload, clipsPayload] = await Promise.all([
        input.get(`/videos?user_id=${encodeURIComponent(channel.id)}&first=6`),
        input.get(
          `/clips?broadcaster_id=${encodeURIComponent(channel.id)}&first=6`
        )
      ]);
      return {
        clips: dataFrom(clipsPayload).flatMap((row) => toClip(row, channel)),
        videos: dataFrom(videosPayload).flatMap((row) => toVideo(row, channel))
      };
    })
  );
  return {
    clips: pages.flatMap((page) => page.clips).slice(0, MEDIA_ITEM_LIMIT),
    videos: pages.flatMap((page) => page.videos).slice(0, MEDIA_ITEM_LIMIT)
  };
}

function toVideo(
  record: JsonRecord,
  channel: SearchChannel
): readonly SearchVideo[] {
  const id = identifierAt(record, "id");
  const publishedAt = timestampAt(record, "published_at");
  if (id === "" || publishedAt === null) return [];
  const type = videoType(record.type);
  return [
    {
      channelAvatar: channel.avatarUrl,
      channelDisplayName:
        firstString(record, ["user_name", "user_login"]) || channel.displayName,
      channelId: identifierAt(record, "user_id") || channel.id,
      channelName:
        firstString(record, ["user_login", "user_name"]) || channel.username,
      duration: parseTwitchDuration(stringAt(record, "duration")),
      id,
      platform: "twitch",
      publishedAt,
      thumbnailUrl: stringAt(record, "thumbnail_url")
        .replaceAll("%{width}", "640")
        .replaceAll("%{height}", "360")
        .replaceAll("{width}", "640")
        .replaceAll("{height}", "360"),
      title: stringAt(record, "title"),
      type,
      url: stringAt(record, "url"),
      viewCount: nonNegativeNumberAt(record, "view_count")
    }
  ];
}

function toClip(
  record: JsonRecord,
  channel: SearchChannel
): readonly SearchClip[] {
  const id = identifierAt(record, "id");
  const createdAt = timestampAt(record, "created_at");
  if (id === "" || createdAt === null) return [];
  return [
    {
      channelAvatar: channel.avatarUrl,
      channelDisplayName: channel.displayName,
      channelId: identifierAt(record, "broadcaster_id") || channel.id,
      channelName: stringAt(record, "broadcaster_name") || channel.username,
      clipUrl: stringAt(record, "url"),
      createdAt,
      creatorName: stringAt(record, "creator_name"),
      duration: nonNegativeNumberAt(record, "duration"),
      id,
      platform: "twitch",
      thumbnailUrl: stringAt(record, "thumbnail_url"),
      title: stringAt(record, "title"),
      viewCount: nonNegativeNumberAt(record, "view_count")
    }
  ];
}

function videoType(value: unknown): SearchVideo["type"] {
  return value === "highlight" || value === "upload" ? value : "archive";
}

export function parseTwitchDuration(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (match === null) return 0;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

function timestampAt(
  record: JsonRecord,
  key: string
): SearchVideo["publishedAt"] | null {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString() as SearchVideo["publishedAt"];
}

function dataFrom(value: unknown): JsonRecord[] {
  if (value === null || typeof value !== "object" || !("data" in value)) {
    return [];
  }
  const data = (value as { data: unknown }).data;
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function identifierAt(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? `${value}`
      : "";
}

function firstString(record: JsonRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringAt(record, key);
    if (value !== "") return value;
  }
  return "";
}

function nonNegativeNumberAt(record: JsonRecord, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
