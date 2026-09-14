import type { Clip, Video } from "@streamfusion/core/content";

import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

export function watchTargetFromVideo(video: Video): WatchTarget {
  return {
    channelId: video.channelId,
    channelName: video.channelName,
    media: {
      durationSeconds: video.duration,
      id: video.id,
      kind: "video",
      title: video.title,
      ...(isPlaybackUri(video.url) ? { sourceUri: video.url } : {}),
    },
    platform: video.platform,
  };
}

export function watchTargetFromClip(clip: Clip): WatchTarget {
  return {
    channelId: clip.channelId,
    channelName: clip.channelName,
    media: {
      durationSeconds: clip.duration,
      id: clip.id,
      kind: "clip",
      title: clip.title,
    },
    platform: clip.platform,
  };
}

function isPlaybackUri(value: string): boolean {
  return (
    value.startsWith("https://") &&
    (value.includes(".m3u8") || value.includes(".mp4"))
  );
}
