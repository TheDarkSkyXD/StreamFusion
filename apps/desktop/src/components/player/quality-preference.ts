import type { VideoQuality } from "@/shared/auth-types";

import type { QualityLevel } from "./types";

export type PlayerQualityPreference = VideoQuality | "highest" | "source";

const QUALITY_HEIGHT_MAP: Record<Exclude<VideoQuality, "auto" | "highest">, number> = {
  "1440p": 1440,
  "2k": 1440,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
  "160p": 160,
};

function qualityHeight(level: QualityLevel): number {
  if (level.height > 0) return level.height;
  const text = `${level.name ?? ""} ${level.label}`;
  if (/\b2k\b/i.test(text)) return 1440;
  return Number(/\b(\d{3,4})p(?:\d{2})?\b/i.exec(text)?.[1] ?? 0);
}

function byHighestQuality(a: QualityLevel, b: QualityLevel): number {
  return (
    qualityHeight(b) - qualityHeight(a) ||
    b.bitrate - a.bitrate ||
    b.width - a.width ||
    (b.frameRate ?? 0) - (a.frameRate ?? 0)
  );
}

function isSource(level: QualityLevel): boolean {
  return level.isSource === true;
}

export function resolvePreferredQualityId(
  levels: QualityLevel[],
  preference: PlayerQualityPreference | string
): string {
  const normalizedPreference = String(preference).toLowerCase();
  if (normalizedPreference === "auto") return "auto";

  const realLevels = levels.filter((level) => !level.isAuto);
  if (realLevels.length === 0) return "auto";

  if (normalizedPreference === "highest" || normalizedPreference === "source") {
    return realLevels.find(isSource)?.id ?? [...realLevels].sort(byHighestQuality)[0].id;
  }

  const parsedHeight = /^(\d+)p(?:\d+)?$/.exec(normalizedPreference)?.[1];
  const targetHeight =
    QUALITY_HEIGHT_MAP[normalizedPreference as Exclude<VideoQuality, "auto" | "highest">] ??
    (parsedHeight ? Number(parsedHeight) : 0);
  if (!targetHeight) return "auto";

  const targetStrings =
    normalizedPreference === "1440p" || normalizedPreference === "2k"
      ? ["1440", "2k"]
      : [normalizedPreference.replace("p", "")];
  const namedWithoutHeight = realLevels
    .filter((level) => {
      const searchableName = `${level.name ?? ""} ${level.label}`.toLowerCase();
      return level.height <= 0 && targetStrings.some((target) => searchableName.includes(target));
    })
    .sort(byHighestQuality)[0];

  const atOrBelowCeiling = realLevels
    .filter((level) => level.height > 0 && level.height <= targetHeight)
    .sort(byHighestQuality);
  if (namedWithoutHeight) return namedWithoutHeight.id;
  if (atOrBelowCeiling.length > 0) return atOrBelowCeiling[0].id;

  const aboveCeiling = realLevels
    .filter((level) => level.height > 0)
    .sort((a, b) => a.height - b.height || b.bitrate - a.bitrate);
  if (aboveCeiling.length > 0) return aboveCeiling[0].id;

  const byBitrate = [...realLevels].sort((a, b) => b.bitrate - a.bitrate);
  return targetHeight >= 720 ? byBitrate[0].id : byBitrate[byBitrate.length - 1].id;
}

export function qualityLevelToPreference(level: QualityLevel): PlayerQualityPreference | string {
  if (level.isAuto || level.id === "auto") return "auto";
  if (level.isSource) return "highest";
  if (level.height > 0) return `${level.height}p`;

  const namedHeight = /(\d+)p/i.exec(`${level.name ?? ""} ${level.label}`)?.[1];
  return namedHeight ? `${namedHeight}p` : "auto";
}
