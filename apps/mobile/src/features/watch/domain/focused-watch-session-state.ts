import type {
  FocusedPlaybackProtection,
  FocusedWatchState,
  NativePlaybackEvent,
  PlaybackIntegration,
  PlaybackPhase,
  PlaybackProgress,
  PlaybackSessionState,
  WatchPeek,
  WatchPlaybackFailure,
  WatchTarget,
} from "../capabilities/watch";

export const IDLE_PROGRESS: PlaybackProgress = {
  durationMs: 0,
  positionMs: 0,
  seekable: false,
};

export const IDLE_PEEK: WatchPeek = { kind: "idle" };

export type CurrentSession =
  | { readonly kind: "ready"; readonly target: WatchTarget }
  | { readonly kind: "resolving"; readonly target: WatchTarget }
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "active";
      readonly lease: { release(): void };
      readonly phase: PlaybackPhase;
      readonly policySequence: number;
      readonly protection: FocusedPlaybackProtection;
      readonly session: PlaybackSessionState;
      readonly target: WatchTarget;
    }
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "ended";
      readonly sessionId: string;
      readonly target: WatchTarget;
    }
  | {
      readonly failure: WatchPlaybackFailure;
      readonly kind: "failed";
      readonly target: WatchTarget;
    };

export function toWatchState(current: CurrentSession): FocusedWatchState {
  if (current.kind === "active") {
    const { lease: _lease, ...state } = current;
    return state;
  }
  return current;
}

export function phaseFrom(event: NativePlaybackEvent): PlaybackPhase {
  if (event.kind === "paused") return "paused";
  if (event.kind === "playing") return "playing";
  return "buffering";
}
