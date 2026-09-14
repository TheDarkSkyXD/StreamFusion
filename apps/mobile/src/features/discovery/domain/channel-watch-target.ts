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
      ...(isHttpsAsset(video.thumbnailUrl)
        ? { thumbnailUrl: video.thumbnailUrl }
        : {}),
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
      ...(isHttpsAsset(clip.thumbnailUrl)
        ? { thumbnailUrl: clip.thumbnailUrl }
        : {}),
    },
    platform: clip.platform,
  };
}

function isHttpsAsset(value: string): boolean {
  return value.startsWith("https://") && value.length <= 2048;
}

function isPlaybackUri(value: string): boolean {
  return (
    isHttpsAsset(value) &&
    (value.includes(".m3u8") || value.includes(".mp4"))
  );
}
