import type {
  NativePlaybackEvent,
  PlaybackProgress,
} from "../capabilities/watch";
import {
  returnFromPictureInPicture,
  type PlayerPresentationState,
} from "./player-presentation";
import {
  phaseFrom,
  type CurrentSession,
} from "./focused-watch-session-state";

export type NativePlaybackNext =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "next";
      readonly current: CurrentSession;
      readonly presentation: PlayerPresentationState;
      readonly progress: PlaybackProgress;
      readonly refreshQualities: boolean;
      readonly releaseLease: boolean;
    };

export function nextNativePlayback(input: {
  readonly current: CurrentSession;
  readonly event: NativePlaybackEvent;
  readonly presentation: PlayerPresentationState;
  readonly progress: PlaybackProgress;
}): NativePlaybackNext {
  const { current, event } = input;
  if (current.kind !== "active" || current.session.sessionId !== event.sessionId) {
    return { kind: "ignore" };
  }
  if (event.kind === "picture-in-picture-exited") {
    return next(current, returnFromPictureInPicture(input.presentation), input.progress);
  }
  if (event.kind === "ended") {
    return next(
      {
        integration: current.integration,
        kind: "ended",
        sessionId: event.sessionId,
        target: current.target,
      },
      input.presentation,
      input.progress,
      true,
    );
  }
  if (event.kind === "failed") {
    return next(
      {
        failure: {
          code: event.code,
          detail: event.detail,
          integration: current.integration,
          kind: "playback-failed",
          lastSuccessfulStage: "native-session-started",
          platform: current.target.platform,
          recovery: ["retry", "open-provider"],
        },
        kind: "failed",
        target: current.target,
      },
      input.presentation,
      input.progress,
      true,
    );
  }
  if (event.kind === "progress") {
    return next(current, input.presentation, {
      durationMs: event.durationMs,
      positionMs: event.positionMs,
      seekable: event.seekable,
    });
  }
  return next(
    { ...current, phase: phaseFrom(event) },
    input.presentation,
    input.progress,
    false,
    event.kind === "playing",
  );
}

function next(
  current: CurrentSession,
  presentation: PlayerPresentationState,
  progress: PlaybackProgress,
  releaseLease = false,
  refreshQualities = false,
): NativePlaybackNext {
  return {
    current,
    kind: "next",
    presentation,
    progress,
    refreshQualities,
    releaseLease,
  };
}
