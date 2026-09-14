import { streamsMatchChannelIdentity } from "@streamfusion/core/platform";

import type {
  FocusedWatchState,
  WatchPlaybackFailure,
  WatchRecovery,
  WatchTarget,
} from "../capabilities/watch";

export type WatchPrimaryAction = "start" | "retry" | "none";

export type WatchView = {
  readonly detail: string;
  readonly primaryAction: WatchPrimaryAction;
  readonly recovery: readonly WatchRecovery[];
  readonly sessionId: string | null;
  readonly showPlayer: boolean;
  readonly title: string;
};

export function composeWatchView(state: FocusedWatchState): WatchView {
  if (state.kind === "ready") {
    return view("Watch", "Start watching this live stream.", "start", null, false, []);
  }
  if (state.kind === "resolving") {
    return view(
      "Starting Watch",
      "Resolving a live source for this stream.",
      "none",
      null,
      false,
      [],
    );
  }
  if (state.kind === "active") {
    return view(
      phaseTitle(state.phase),
      protectionDetail(state),
      "none",
      state.session.sessionId,
      true,
      [],
    );
  }
  if (state.kind === "ended") {
    return view(
      "Stream ended",
      "This live stream is no longer playing.",
      "retry",
      null,
      false,
      ["retry", "open-provider"],
    );
  }
  return failureView(state.failure);
}

export function sameWatchTarget(
  first: WatchTarget,
  second: WatchTarget,
): boolean {
  return streamsMatchChannelIdentity(first, second);
}

function failureView(failure: WatchPlaybackFailure): WatchView {
  if (failure.kind === "compatibility-disabled") {
    return view(
      "Watch unavailable",
      "Live playback is disabled by the current capability policy.",
      "retry",
      null,
      false,
      failure.recovery,
    );
  }
  if (failure.kind === "source-unavailable") {
    return view(
      sourceTitle(failure.code),
      failure.detail,
      "retry",
      null,
      false,
      failure.recovery,
    );
  }
  if (failure.kind === "native-unavailable") {
    return view(
      "Player unavailable",
      failure.detail,
      "retry",
      null,
      false,
      failure.recovery,
    );
  }
  return view(
    "Playback stopped",
    failure.detail,
    "retry",
    null,
    false,
    failure.recovery,
  );
}

function sourceTitle(
  code: Extract<WatchPlaybackFailure, { kind: "source-unavailable" }>["code"],
): string {
  if (code === "channel-offline") return "Channel is offline";
  if (code === "offline") return "Network unavailable";
  if (code === "provider-rejected") return "Provider rejected playback";
  return "Live source unavailable";
}

function phaseTitle(phase: "buffering" | "paused" | "playing"): string {
  if (phase === "buffering") return "Buffering";
  if (phase === "paused") return "Paused";
  return "Playing";
}

function protectionDetail(
  state: Extract<FocusedWatchState, { kind: "active" }>,
): string {
  if (state.protection.kind === "normal") {
    return state.phase === "buffering"
      ? "The player is buffering this live stream."
      : "Focused live playback is active.";
  }
  return state.protection.detail;
}

function view(
  title: string,
  detail: string,
  primaryAction: WatchPrimaryAction,
  sessionId: string | null,
  showPlayer: boolean,
  recovery: readonly WatchRecovery[],
): WatchView {
  return { detail, primaryAction, recovery, sessionId, showPlayer, title };
}
