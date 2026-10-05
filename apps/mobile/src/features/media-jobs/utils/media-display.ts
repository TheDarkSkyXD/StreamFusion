import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";
export type MediaDisplayMetadata = {
  readonly title: string;
  readonly channelName: string;
  readonly platform: "twitch" | "kick";
  readonly contentKind: "video" | "clip" | "recording";
  readonly sourceIdentity: string;
  readonly thumbnailUrl: string | null;
};
export function parseMediaDisplay(value: unknown): MediaDisplayMetadata | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !("channelName" in value) ||
    typeof value.channelName !== "string" ||
    !("platform" in value) ||
    (value.platform !== "twitch" && value.platform !== "kick") ||
    !("contentKind" in value) ||
    (value.contentKind !== "video" &&
      value.contentKind !== "clip" &&
      value.contentKind !== "recording") ||
    !("sourceIdentity" in value) ||
    typeof value.sourceIdentity !== "string" ||
    !("thumbnailUrl" in value) ||
    (value.thumbnailUrl !== null && typeof value.thumbnailUrl !== "string")
  )
    return null;
  return {
    title: value.title,
    channelName: value.channelName,
    platform: value.platform,
    contentKind: value.contentKind,
    sourceIdentity: value.sourceIdentity,
    thumbnailUrl: value.thumbnailUrl,
  };
}
export function mediaJobDisplay(
  snapshot: MediaJobSnapshot,
): MediaDisplayMetadata | null {
  return "display" in snapshot.intent
    ? parseMediaDisplay(snapshot.intent.display)
    : null;
}
