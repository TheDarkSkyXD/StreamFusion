import type { PlaybackFiltering } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
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

export function createWatchRuntime(input: {
  readonly filtering?: PlaybackFiltering;
  readonly inspection: WatchInspectionReader;
  readonly playback: FocusedPlaybackPort;
  readonly policy: PlaybackCompatibilityPolicy;
  readonly protection: FocusedPlaybackProtectionPort;
  readonly recorded?: RecordedPlaybackSources;
  readonly sessionIds: WatchSessionIdSource;
  readonly sources: LivePlaybackSources;
}): WatchRuntime {
  return {
    inspection: input.inspection,
    session: createFocusedWatchSession(input),
  };
}
