import { streamsMatchChannelIdentity } from "@streamfusion/core/platform";

import type { WatchMedia, WatchTarget } from "../capabilities/watch";

export function sameWatchTarget(
  first: WatchTarget,
  second: WatchTarget,
): boolean {
  return (
    streamsMatchChannelIdentity(first, second) &&
    mediaKey(first.media) === mediaKey(second.media)
  );
}

export function watchMediaFromVideo(input: {
  readonly duration: number;
  readonly id: string;
  readonly sourceUri?: string;
  readonly title: string;
}): WatchMedia {
  return {
    durationSeconds: Math.max(0, Math.floor(input.duration)),
    id: input.id,
    kind: "video",
    title: input.title,
    ...(input.sourceUri === undefined ? {} : { sourceUri: input.sourceUri }),
  };
}

export function watchMediaFromClip(input: {
  readonly duration: number;
  readonly id: string;
  readonly title: string;
}): WatchMedia {
  return {
    durationSeconds: Math.max(0, Math.floor(input.duration)),
    id: input.id,
    kind: "clip",
    title: input.title,
  };
}

function mediaKey(media: WatchMedia | undefined): string {
  return media === undefined ? "live" : `${media.kind}:${media.id}`;
}
