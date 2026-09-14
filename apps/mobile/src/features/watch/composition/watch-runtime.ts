import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  LivePlaybackSources,
  PlaybackCompatibilityPolicy,
  WatchInspectionReader,
  WatchRuntime,
  WatchSessionIdSource,
} from "../capabilities/watch";
import { createFocusedWatchSession } from "../domain/focused-watch-session";

export function createWatchRuntime(input: {
  readonly inspection: WatchInspectionReader;
  readonly playback: FocusedPlaybackPort;
  readonly policy: PlaybackCompatibilityPolicy;
  readonly protection: FocusedPlaybackProtectionPort;
  readonly sessionIds: WatchSessionIdSource;
  readonly sources: LivePlaybackSources;
}): WatchRuntime {
  return {
    inspection: input.inspection,
    session: createFocusedWatchSession(input),
  };
}
