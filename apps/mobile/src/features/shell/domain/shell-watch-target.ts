import type { Platform } from "@streamfusion/core/platform";

export type ShellWatchMedia = {
  readonly durationSeconds: number;
  readonly id: string;
  readonly kind: "clip" | "video";
  readonly resumePositionSeconds?: number;
  readonly sourceUri?: string;
  readonly thumbnailUrl?: string;
  readonly title: string;
};

export type ShellWatchChannelTarget = {
  readonly kind: "channel";
  readonly platform: Platform;
  readonly channelId: string;
  readonly channelLogin: string;
  readonly media?: ShellWatchMedia;
};

export function locationTargetFromWatch(target: {
  readonly channelId: string;
  readonly channelName: string;
  readonly platform: Platform;
  readonly media?: ShellWatchMedia;
}): ShellWatchChannelTarget {
  return attachWatchMedia(
    {
      channelId: target.channelId,
      channelLogin: target.channelName,
      kind: "channel",
      platform: target.platform,
    },
    target.media,
  );
}

export function watchTargetFromLocation(target: ShellWatchChannelTarget): {
  readonly channelId: string;
  readonly channelName: string;
  readonly platform: Platform;
  readonly media?: ShellWatchMedia;
} {
  return attachWatchMedia(
    {
      channelId: target.channelId,
      channelName: target.channelLogin,
      platform: target.platform,
    },
    target.media,
  );
}

export function isWatchChannelTarget(
  value: Readonly<Record<string, unknown>>,
): boolean {
  const keys = ["kind", "platform", "channelId", "channelLogin"];
  const allowed = value.media === undefined ? keys : [...keys, "media"];
  if (
    !hasOnlyKeys(value, allowed) ||
    !isPlatform(value.platform) ||
    typeof value.channelId !== "string" ||
    !identifierPattern.test(value.channelId) ||
    typeof value.channelLogin !== "string" ||
    !channelLoginPattern.test(value.channelLogin)
  ) {
    return false;
  }
  if (value.media === undefined) return true;
  return isRecord(value.media) && isWatchMedia(value.media);
}

function attachWatchMedia<T extends object>(
  value: T,
  media: ShellWatchMedia | undefined,
): T | (T & { readonly media: ShellWatchMedia }) {
  return media === undefined ? value : { ...value, media };
}

function isWatchMedia(media: Readonly<Record<string, unknown>>): boolean {
  const mediaKeys = ["durationSeconds", "id", "kind", "title"];
  const optional = [
    ...(media.sourceUri === undefined ? [] : (["sourceUri"] as const)),
    ...(media.thumbnailUrl === undefined ? [] : (["thumbnailUrl"] as const)),
    ...(media.resumePositionSeconds === undefined
      ? []
      : (["resumePositionSeconds"] as const)),
  ];
  return (
    hasOnlyKeys(media, [...mediaKeys, ...optional]) &&
    (media.kind === "clip" || media.kind === "video") &&
    typeof media.id === "string" &&
    identifierPattern.test(media.id) &&
    typeof media.title === "string" &&
    media.title.length >= 1 &&
    media.title.length <= 256 &&
    typeof media.durationSeconds === "number" &&
    Number.isFinite(media.durationSeconds) &&
    media.durationSeconds >= 0 &&
    (media.sourceUri === undefined ||
      (typeof media.sourceUri === "string" &&
        media.sourceUri.startsWith("https://") &&
        media.sourceUri.length <= 2048)) &&
    (media.thumbnailUrl === undefined ||
      (typeof media.thumbnailUrl === "string" &&
        media.thumbnailUrl.startsWith("https://") &&
        media.thumbnailUrl.length <= 2048)) &&
    (media.resumePositionSeconds === undefined ||
      (typeof media.resumePositionSeconds === "number" &&
        Number.isInteger(media.resumePositionSeconds) &&
        media.resumePositionSeconds >= 0))
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

const identifierPattern = /^[a-zA-Z0-9._:-]{1,256}$/u;
const channelLoginPattern = /^[a-zA-Z0-9_-]{1,64}$/u;
