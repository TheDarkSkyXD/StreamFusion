import type {
  NativePlaybackEvent,
  PlaybackProgress,
} from "../capabilities/watch";
import { adsDetectedFromFilteringEvent } from "./adblock-playback-status";
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
      readonly adsDetected: boolean;
      readonly current: CurrentSession;
      readonly presentation: PlayerPresentationState;
      readonly progress: PlaybackProgress;
      readonly refreshQualities: boolean;
      readonly releaseLease: boolean;
    };

export function nextNativePlayback(input: {
  readonly adsDetected: boolean;
  readonly current: CurrentSession;
  readonly event: NativePlaybackEvent;
  readonly presentation: PlayerPresentationState;
  readonly progress: PlaybackProgress;
}): NativePlaybackNext {
  const { current, event } = input;
  if (current.kind !== "active" || current.session.sessionId !== event.sessionId) {
    return { kind: "ignore" };
  }
  if (event.kind === "filtering") {
    return next({
      adsDetected: adsDetectedFromFilteringEvent(event),
      current,
      presentation: input.presentation,
      progress: input.progress,
    });
  }
  if (event.kind === "picture-in-picture-exited") {
    return next({
      adsDetected: input.adsDetected,
      current,
      presentation: returnFromPictureInPicture(input.presentation),
      progress: input.progress,
    });
  }
  if (event.kind === "ended") {
    return next({
      adsDetected: false,
      current: {
        integration: current.integration,
        kind: "ended",
        sessionId: event.sessionId,
        target: current.target,
      },
      presentation: input.presentation,
      progress: input.progress,
      releaseLease: true,
    });
  }
  if (event.kind === "failed") {
    return next({
      adsDetected: false,
      current: {
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
      presentation: input.presentation,
      progress: input.progress,
      releaseLease: true,
    });
  }
  if (event.kind === "progress") {
    return next({
      adsDetected: input.adsDetected,
      current,
      presentation: input.presentation,
      progress: {
        durationMs: event.durationMs,
        positionMs: event.positionMs,
        seekable: event.seekable,
      },
    });
  }
  return next({
    adsDetected: input.adsDetected,
    current: { ...current, phase: phaseFrom(event) },
    presentation: input.presentation,
    progress: input.progress,
    refreshQualities: event.kind === "playing",
  });
}

function next(input: {
  readonly adsDetected: boolean;
  readonly current: CurrentSession;
  readonly presentation: PlayerPresentationState;
  readonly progress: PlaybackProgress;
  readonly refreshQualities?: boolean;
  readonly releaseLease?: boolean;
}): NativePlaybackNext {
  return {
    adsDetected: input.adsDetected,
    current: input.current,
    kind: "next",
    presentation: input.presentation,
    progress: input.progress,
    refreshQualities: input.refreshQualities === true,
    releaseLease: input.releaseLease === true,
  };
}
