import type {
  LivePlaybackSourceResolution,
  LivePlaybackSources,
  PlaybackIntegration,
  RecordedPlaybackSources,
  WatchTarget,
} from "../capabilities/watch";

export function resolveWatchSource(
  sources: LivePlaybackSources,
  recorded: RecordedPlaybackSources | undefined,
  target: WatchTarget,
  signal: AbortSignal,
): Promise<LivePlaybackSourceResolution> {
  const media = target.media;
  if (media?.kind === "video" && target.platform === "kick") {
    return recorded
      ? recorded.kickVideo.resolve({
          signal,
          target: { ...target, platform: "kick" },
        })
      : missingRecorded("kick-v2-video");
  }
  if (media?.kind === "video") {
    return recorded
      ? recorded.twitchVideo.resolve({
          signal,
          target: { ...target, platform: "twitch" },
        })
      : missingRecorded("twitch-gql-vod");
  }
  if (media?.kind === "clip" && target.platform === "twitch") {
    return recorded
      ? recorded.twitchClip.resolve({
          signal,
          target: { ...target, platform: "twitch" },
        })
      : missingRecorded("twitch-gql-clip");
  }
  if (media?.kind === "clip") {
    return Promise.resolve({
      failure: {
        detail: "Kick clips are not available in this build.",
        kind: "invalid-response",
      },
      integration: "kick-v2-video",
      kind: "unavailable",
    });
  }
  if (target.platform === "kick") {
    return sources.kick.resolve({
      signal,
      target: { ...target, platform: "kick" },
    });
  }
  return sources.twitch.resolve({
    signal,
    target: { ...target, platform: "twitch" },
  });
}

export function integrationFor(target: WatchTarget): PlaybackIntegration {
  if (target.media?.kind === "video") {
    return target.platform === "kick" ? "kick-v2-video" : "twitch-gql-vod";
  }
  if (target.media?.kind === "clip") {
    return target.platform === "twitch" ? "twitch-gql-clip" : "kick-v2-video";
  }
  return target.platform === "twitch" ? "twitch-gql-usher" : "kick-v1-playback-url";
}

function missingRecorded(
  integration: PlaybackIntegration,
): Promise<LivePlaybackSourceResolution> {
  return Promise.resolve({
    failure: {
      detail: "Recorded playback sources are not wired.",
      kind: "invalid-response",
    },
    integration,
    kind: "unavailable",
  });
}
