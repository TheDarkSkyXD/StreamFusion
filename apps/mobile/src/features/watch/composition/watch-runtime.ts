import type { PlaybackFiltering } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { TwitchPlaylistProxyPreferences } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import type { PlaybackSessionPolicy } from "@mobile/features/settings/capabilities/settings";
import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  LivePlaybackSources,
  PlaybackCompatibilityPolicy,
  RecordedPlaybackSources,
  WatchInspectionReader,
  WatchRuntime,
  WatchSessionIdSource,
} from "../capabilities/watch";
import { createFocusedWatchSession } from "../domain/focused-watch-session";
import { resolveWatchSource } from "../domain/watch-source-resolution";

export function createWatchRuntime(input: {
  readonly filtering?: PlaybackFiltering;
  readonly inspection: WatchInspectionReader;
  readonly playback: FocusedPlaybackPort;
  readonly playbackSettings?: { snapshot(): PlaybackSessionPolicy };
  readonly playlistProxy?: {
    snapshot(): Promise<TwitchPlaylistProxyPreferences>;
  };
  readonly policy: PlaybackCompatibilityPolicy;
  readonly protection: FocusedPlaybackProtectionPort;
  readonly recorded?: RecordedPlaybackSources;
  readonly sessionIds: WatchSessionIdSource;
  readonly sources: LivePlaybackSources;
}): WatchRuntime {
  return {
    inspection: input.inspection,
    resolveSource: (target, signal) =>
      resolveWatchSource(input.sources, input.recorded, target, signal),
    session: createFocusedWatchSession(input),
  };
}
