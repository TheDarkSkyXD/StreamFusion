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
import { resolveWatchSource } from "../domain/watch-source-resolution";

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
    resolveSource: (target, signal) =>
      resolveWatchSource(input.sources, input.recorded, target, signal),
    session: createFocusedWatchSession(input),
  };
}
