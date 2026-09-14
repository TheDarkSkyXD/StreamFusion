import { streamsMatchChannelIdentity } from "@streamfusion/core/platform";

import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtection,
  FocusedPlaybackProtectionPort,
  FocusedPictureInPictureResult,
  FocusedWatchSession,
  FocusedWatchState,
  LivePlaybackSourceResolution,
  LivePlaybackSources,
  MiniPlayerSnapRegion,
  NativePlaybackEvent,
  PlaybackCompatibilityPolicy,
  PlaybackIntegration,
  PlaybackPhase,
  PlaybackSessionState,
  WatchPlaybackFailure,
  WatchPeek,
  WatchSessionIdSource,
  WatchStartResult,
  WatchTarget,
} from "../capabilities/watch";
import {
  INITIAL_PLAYER_PRESENTATION,
  applyPictureInPictureResult,
  concealFromWatch,
  enterFullscreen as toFullscreen,
  exitFullscreen as fromFullscreen,
  relocateMiniPlayer as moveMini,
  requestPictureInPicture,
  returnFromPictureInPicture,
  revealInWatch,
  type PlayerPresentationState,
} from "./player-presentation";

const IDLE_PEEK: WatchPeek = { kind: "idle" };

function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    const schedule =
      typeof requestAnimationFrame === "function"
        ? (callback: () => void) => requestAnimationFrame(callback)
        : (callback: () => void) => setTimeout(callback, 0);
    schedule(() => schedule(() => resolve()));
  });
}

export function createFocusedWatchSession(input: {
  readonly playback: FocusedPlaybackPort;
  readonly policy: PlaybackCompatibilityPolicy;
  readonly protection: FocusedPlaybackProtectionPort;
  readonly sessionIds: WatchSessionIdSource;
  readonly sources: LivePlaybackSources;
}): FocusedWatchSession {
  const listeners = new Set<() => void>();
  let generation = 0;
  let current: CurrentSession | null = null;
  let presentation: PlayerPresentationState = INITIAL_PLAYER_PRESENTATION;
  let muted = false;
  let volume = 1;
  let quality = "auto";
  let qualities: readonly string[] = ["auto"];
  let cachedPeek: WatchPeek = IDLE_PEEK;
  let cachedSnapshot: FocusedWatchState | null = null;
  let cachedSnapshotTarget: WatchTarget | null = null;
  const refreshViewCache = () => {
    cachedSnapshot = null;
    cachedSnapshotTarget = null;
    if (current?.kind !== "active") {
      cachedPeek = IDLE_PEEK;
      return;
    }
    cachedPeek = {
      kind: "active",
      muted,
      presentation,
      quality,
      qualities,
      state: toState(current) as Extract<FocusedWatchState, { kind: "active" }>,
      volume,
    };
  };
  const notify = () => {
    refreshViewCache();
    listeners.forEach((listener) => listener());
  };
  const unsubscribeNative = input.playback.subscribe((event) => {
    applyNativeEvent(event);
  });
  const unsubscribeProtection = input.protection.subscribe(() => {
    if (current?.kind === "active") {
      current = { ...current, protection: input.protection.snapshot() };
      notify();
    }
  });

  async function refreshQualities(): Promise<void> {
    if (current?.kind !== "active") return;
    const sessionId = current.session.sessionId;
    const listed = await input.playback.listQualities(sessionId);
    if (
      current?.kind !== "active" ||
      current.session.sessionId !== sessionId ||
      listed.kind !== "listed"
    ) {
      return;
    }
    quality = listed.catalog.selected;
    qualities = listed.catalog.qualities;
    notify();
  }

  function applyNativeEvent(event: NativePlaybackEvent): void {
    if (current?.kind !== "active" || current.session.sessionId !== event.sessionId) {
      return;
    }
    if (event.kind === "picture-in-picture-exited") {
      presentation = returnFromPictureInPicture(presentation);
      notify();
      return;
    }
    if (event.kind === "ended") {
      current.lease.release();
      current = {
        integration: current.integration,
        kind: "ended",
        sessionId: event.sessionId,
        target: current.target,
      };
      notify();
      return;
    }
    if (event.kind === "failed") {
      current.lease.release();
      current = {
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
      };
      notify();
      return;
    }
    current = { ...current, phase: phaseFrom(event) };
    notify();
    if (event.kind === "playing") {
      void refreshQualities();
    }
  }

  async function abandon(sessionId: string): Promise<void> {
    const result = await input.playback.end(sessionId);
    if (result.kind === "unavailable") return;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot(target) {
      if (
        cachedSnapshot &&
        cachedSnapshotTarget &&
        streamsMatchChannelIdentity(cachedSnapshotTarget, target)
      ) {
        return cachedSnapshot;
      }
      cachedSnapshotTarget = target;
      cachedSnapshot =
        current && streamsMatchChannelIdentity(current.target, target)
          ? toState(current)
          : { kind: "ready", target };
      return cachedSnapshot;
    },
    peek(): WatchPeek {
      return cachedPeek;
    },
    conceal() {
      const next = concealFromWatch(presentation);
      if (next === presentation) return;
      presentation = next;
      notify();
    },
    reveal() {
      const next = revealInWatch(presentation);
      if (next === presentation) return;
      presentation = next;
      notify();
    },
    relocateMiniPlayer(region: MiniPlayerSnapRegion) {
      presentation = moveMini(presentation, region);
      notify();
    },
    enterFullscreen() {
      presentation = toFullscreen(presentation);
      notify();
    },
    exitFullscreen() {
      presentation = fromFullscreen(presentation);
      notify();
    },
    async setPlaying(playing) {
      if (current?.kind !== "active") return;
      await input.playback.setPlaying(current.session.sessionId, playing);
    },
    async setMuted(nextMuted) {
      if (current?.kind !== "active") return;
      muted = nextMuted;
      notify();
      await input.playback.setMuted(current.session.sessionId, nextMuted);
    },
    async setVolume(nextVolume) {
      if (current?.kind !== "active") return;
      volume = nextVolume;
      notify();
      await input.playback.setVolume(current.session.sessionId, nextVolume);
    },
    async setQuality(nextQuality) {
      if (current?.kind !== "active") return;
      const listed = await input.playback.setQuality(
        current.session.sessionId,
        nextQuality,
      );
      if (listed.kind === "listed") {
        quality = listed.catalog.selected;
        qualities = listed.catalog.qualities;
        notify();
      }
    },
    async requestPictureInPicture(): Promise<
      FocusedPictureInPictureResult | { readonly kind: "idle" }
    > {
      if (current?.kind !== "active") return { kind: "idle" };
      presentation = requestPictureInPicture(presentation);
      notify();
      await afterPaint();
      if (current?.kind !== "active") return { kind: "idle" };
      const result = await input.playback.enterPictureInPicture(
        current.session.sessionId,
      );
      if (result.kind === "entered") {
        presentation = applyPictureInPictureResult(presentation, "active");
        notify();
        return result;
      }
      presentation = applyPictureInPictureResult(
        presentation,
        result.kind === "unsupported" ? "unavailable" : "failed",
      );
      notify();
      return result;
    },
    restoreFromPictureInPicture() {
      if (presentation.pip !== "active" && presentation.pip !== "requesting") {
        return;
      }
      presentation = returnFromPictureInPicture(presentation);
      notify();
    },
    async start(target): Promise<WatchStartResult> {
      const attempt = ++generation;
      const previous = current;
      current = { kind: "resolving", target };
      notify();
      if (previous?.kind === "active") {
        previous.lease.release();
        await abandon(previous.session.sessionId);
      }
      if (attempt !== generation) return { kind: "cancelled" };
      const integration: PlaybackIntegration =
        target.platform === "twitch" ? "twitch-gql-usher" : "kick-v1-playback-url";
      const controller = new AbortController();
      const policy = await input.policy.read(target.platform);
      if (attempt !== generation) {
        controller.abort();
        return { kind: "cancelled" };
      }
      if (policy.kind === "disabled") {
        const failed: WatchStartResult = {
          failure: {
            integration,
            kind: "compatibility-disabled",
            lastSuccessfulStage: "none",
            platform: target.platform,
            reason: policy.reason,
            recovery: ["refresh-policy", "open-provider"],
          },
          kind: "failed",
        };
        current = { failure: failed.failure, kind: "failed", target };
        notify();
        return failed;
      }
      const resolved = await resolveSource(input.sources, target, controller.signal);
      if (attempt !== generation) return { kind: "cancelled" };
      if (resolved.kind === "unavailable") {
        if (resolved.failure.kind === "cancelled") return { kind: "cancelled" };
        const failed: WatchStartResult = {
          failure: {
            code: resolved.failure.kind,
            detail: resolved.failure.detail,
            integration,
            kind: "source-unavailable",
            lastSuccessfulStage: "policy-authorized",
            platform: target.platform,
            recovery: ["retry", "open-provider"],
          },
          kind: "failed",
        };
        current = { failure: failed.failure, kind: "failed", target };
        notify();
        return failed;
      }
      const sessionId = input.sessionIds.create();
      const started = await input.playback.start({
        requestHeaders: resolved.requestHeaders,
        sessionId,
        sourceUri: resolved.sourceUri,
      });
      if (attempt !== generation) {
        void abandon(sessionId);
        return { kind: "cancelled" };
      }
      if (started.kind === "unavailable") {
        const failed: WatchStartResult = {
          failure: {
            detail: started.failure.detail,
            integration,
            kind: "native-unavailable",
            lastSuccessfulStage: "source-resolved",
            platform: target.platform,
            recovery: ["retry", "open-provider"],
          },
          kind: "failed",
        };
        current = { failure: failed.failure, kind: "failed", target };
        notify();
        return failed;
      }
      current = {
        integration,
        kind: "active",
        lease: input.protection.acquire(started.session.sessionId),
        phase: "buffering",
        policySequence: policy.sequence,
        protection: input.protection.snapshot(),
        session: started.session,
        target,
      };
      presentation = INITIAL_PLAYER_PRESENTATION;
      muted = false;
      volume = 1;
      quality = "auto";
      qualities = ["auto"];
      notify();
      return { kind: "started", session: started.session };
    },
    async leave(target) {
      if (!current || !streamsMatchChannelIdentity(current.target, target)) {
        return;
      }
      generation += 1;
      presentation = INITIAL_PLAYER_PRESENTATION;
      if (current.kind === "active") {
        const sessionId = current.session.sessionId;
        current.lease.release();
        current = { kind: "ready", target };
        notify();
        await abandon(sessionId);
        return;
      }
      current = { kind: "ready", target };
      notify();
    },
    async dismiss() {
      if (!current) return;
      const target = current.target;
      generation += 1;
      presentation = INITIAL_PLAYER_PRESENTATION;
      if (current.kind === "active") {
        const sessionId = current.session.sessionId;
        current.lease.release();
        current = { kind: "ready", target };
        notify();
        await abandon(sessionId);
        return;
      }
      current = { kind: "ready", target };
      notify();
    },
    async dispose() {
      generation += 1;
      unsubscribeNative();
      unsubscribeProtection();
      listeners.clear();
      if (current?.kind === "active") {
        current.lease.release();
        await abandon(current.session.sessionId);
      }
      current = null;
    },
  };
}

type CurrentSession =
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

function toState(current: CurrentSession): FocusedWatchState {
  if (current.kind === "active") {
    const { lease: _lease, ...state } = current;
    return state;
  }
  return current;
}

async function resolveSource(
  sources: LivePlaybackSources,
  target: WatchTarget,
  signal: AbortSignal,
): Promise<LivePlaybackSourceResolution> {
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

function phaseFrom(event: NativePlaybackEvent): PlaybackPhase {
  if (event.kind === "paused") return "paused";
  if (event.kind === "playing") return "playing";
  return "buffering";
}
