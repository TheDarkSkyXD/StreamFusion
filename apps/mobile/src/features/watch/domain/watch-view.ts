import type {
  FocusedWatchState,
  WatchPlaybackFailure,
  WatchRecovery,
} from "../capabilities/watch";

export type WatchPrimaryAction = "start" | "retry" | "none";

export type WatchCopy =
  | { readonly key: string; readonly values?: Record<string, unknown> }
  | { readonly text: string };

export type WatchView = {
  readonly detail: WatchCopy;
  readonly primaryAction: WatchPrimaryAction;
  readonly recovery: readonly WatchRecovery[];
  readonly sessionId: string | null;
  readonly showPlayer: boolean;
  readonly title: WatchCopy;
};

export function resolveWatchCopy(
  copy: WatchCopy,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  if ("text" in copy) return copy.text;
  return copy.values === undefined ? t(copy.key) : t(copy.key, copy.values);
}

export function composeWatchView(state: FocusedWatchState): WatchView {
  const recorded = Boolean(state.target.media);
  if (state.kind === "ready") {
    return view(
      key("playback.watch.readyTitle"),
      recorded
        ? key("playback.watch.startRecordingDetail")
        : key("playback.watch.startLiveDetail"),
      "start",
      null,
      false,
      [],
    );
  }
  if (state.kind === "resolving") {
    return view(
      key("playback.watch.startingTitle"),
      recorded
        ? key("playback.watch.resolvingRecording")
        : key("playback.watch.resolvingLive"),
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
      recorded
        ? key("playback.watch.recordingEnded")
        : key("playback.watch.streamEnded"),
      recorded
        ? key("playback.watch.recordingEndedDetail")
        : key("playback.watch.streamEndedDetail"),
      "retry",
      null,
      false,
      ["retry", "open-provider"],
    );
  }
  return failureView(state.failure);
}

function failureView(failure: WatchPlaybackFailure): WatchView {
  if (failure.kind === "compatibility-disabled") {
    return view(
      key("playback.watch.watchUnavailable"),
      key("playback.watch.watchUnavailableDetail"),
      "retry",
      null,
      false,
      failure.recovery,
    );
  }
  if (failure.kind === "source-unavailable") {
    return view(
      sourceTitle(failure.code),
      text(failure.detail),
      "retry",
      null,
      false,
      failure.recovery,
    );
  }
  if (failure.kind === "native-unavailable") {
    return view(
      key("playback.watch.playerUnavailable"),
      text(failure.detail),
      "retry",
      null,
      false,
      failure.recovery,
    );
  }
  return view(
    key("playback.watch.playbackStopped"),
    text(failure.detail),
    "retry",
    null,
    false,
    failure.recovery,
  );
}

function sourceTitle(
  code: Extract<WatchPlaybackFailure, { kind: "source-unavailable" }>["code"],
): WatchCopy {
  if (code === "channel-offline") return key("playback.watch.channelOffline");
  if (code === "offline") return key("playback.watch.networkUnavailable");
  if (code === "provider-rejected") return key("playback.watch.providerRejected");
  return key("playback.watch.liveSourceUnavailable");
}

function phaseTitle(phase: "buffering" | "paused" | "playing"): WatchCopy {
  if (phase === "buffering") return key("playback.watch.buffering");
  if (phase === "paused") return key("playback.watch.paused");
  return key("playback.watch.playing");
}

function protectionDetail(
  state: Extract<FocusedWatchState, { kind: "active" }>,
): WatchCopy {
  if (state.protection.kind === "normal") {
    return state.phase === "buffering"
      ? key("playback.watch.bufferingDetail")
      : key("playback.watch.focusedActive");
  }
  return text(state.protection.detail);
}

function key(key: string, values?: Record<string, unknown>): WatchCopy {
  return values ? { key, values } : { key };
}

function text(text: string): WatchCopy {
  return { text };
}

function view(
  title: WatchCopy,
  detail: WatchCopy,
  primaryAction: WatchPrimaryAction,
  sessionId: string | null,
  showPlayer: boolean,
  recovery: readonly WatchRecovery[],
): WatchView {
  return { detail, primaryAction, recovery, sessionId, showPlayer, title };
}
