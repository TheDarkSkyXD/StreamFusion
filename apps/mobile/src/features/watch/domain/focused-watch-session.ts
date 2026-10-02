import type { PlaybackFilterRequest } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { TwitchPlaylistProxyPreferences } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import type { PlaybackSessionPolicy } from "@mobile/features/settings/capabilities/settings";
import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  FocusedPictureInPictureResult,
  FocusedWatchSession,
  FocusedWatchState,
  LivePlaybackSources,
  MiniPlayerSnapRegion,
  NativePlaybackEvent,
  PlaybackCompatibilityPolicy,
  PlaybackProgress,
  RecordedPlaybackSources,
  WatchPeek,
  WatchPlaybackFailure,
  WatchSessionIdSource,
  WatchStartResult,
  WatchTarget,
} from "../capabilities/watch";
import { sameWatchTarget } from "./watch-target";
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
import {
  allowFullscreenLandscapeOrientation,
  restorePortraitOrientation,
} from "./watch-fullscreen-orientation";
import { nextNativePlayback } from "./focused-watch-native-events";
import {
  IDLE_PEEK,
  IDLE_PROGRESS,
  toWatchState,
  type CurrentSession,
} from "./focused-watch-session-state";
import { runFocusedWatchStart, startResultFrom } from "./start-focused-watch";

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
  readonly filtering?: {
    effective(
      platform: WatchTarget["platform"],
    ): Promise<PlaybackFilterRequest>;
  };
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
}): FocusedWatchSession {
  const listeners = new Set<() => void>();
  let generation = 0;
  let current: CurrentSession | null = null;
  let refreshingSessionId: string | null = null;
  let presentation: PlayerPresentationState = INITIAL_PLAYER_PRESENTATION;
  let muted = false;
  let volume = 1;
  let quality = "auto";
  let qualities: readonly string[] = ["auto"];
  let qualityRequestSequence = 0;
  let progress: PlaybackProgress = IDLE_PROGRESS;
  let adsDetected = false;
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
      adsDetected,
      kind: "active",
      muted,
      presentation,
      progress,
      quality,
      qualities,
      state: toWatchState(current) as Extract<
        FocusedWatchState,
        { kind: "active" }
      >,
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
    if (event.sessionId === refreshingSessionId) return;
    if (!current) return;
    const next = nextNativePlayback({
      adsDetected,
      current,
      event,
      presentation,
      progress,
    });
    if (next.kind === "ignore") return;
    if (next.releaseLease && current.kind === "active") {
      current.lease.release();
    }
    current = next.current;
    presentation = next.presentation;
    progress = next.progress;
    adsDetected = next.adsDetected;
    notify();
    if (next.refreshQualities) void refreshQualities();
  }

  async function abandon(sessionId: string): Promise<void> {
    const result = await input.playback.end(sessionId);
    if (result.kind === "unavailable") return;
  }

  async function resetToReady(target: WatchTarget): Promise<void> {
    generation += 1;
    const endingSessionId = refreshingSessionId;
    refreshingSessionId = null;
    const wasFullscreen = presentation.presentation === "fullscreen";
    presentation = INITIAL_PLAYER_PRESENTATION;
    adsDetected = false;
    progress = IDLE_PROGRESS;
    if (wasFullscreen) {
      void restorePortraitOrientation();
    }
    if (current?.kind === "active") {
      const sessionId = current.session.sessionId;
      if (sessionId !== endingSessionId) current.lease.release();
      current = { kind: "ready", target };
      notify();
      if (sessionId !== endingSessionId) await abandon(sessionId);
      return;
    }
    current = { kind: "ready", target };
    notify();
  }

  async function startWithIntent(
    target: WatchTarget,
    intent: "replace" | "refresh",
  ): Promise<WatchStartResult> {
    const previous = current;
    const refreshing =
      intent === "refresh" &&
      refreshingSessionId === null &&
      previous?.kind === "active" &&
      sameWatchTarget(previous.target, target);
    if (intent === "refresh" && !refreshing) return { kind: "cancelled" };

    const attempt = ++generation;
    const endingSessionId = refreshingSessionId;
    refreshingSessionId = refreshing ? previous.session.sessionId : null;
    current = refreshing
      ? { ...previous, phase: "buffering" }
      : { kind: "resolving", target };
    notify();
    if (
      previous?.kind === "active" &&
      previous.session.sessionId !== endingSessionId
    ) {
      previous.lease.release();
      await abandon(previous.session.sessionId);
    }
    if (attempt !== generation) return { kind: "cancelled" };

    const outcome = await runFocusedWatchStart({
      attempt,
      generation: () => generation,
      playback: input.playback,
      policy: input.policy,
      protection: input.protection,
      sessionIds: input.sessionIds,
      sources: input.sources,
      target,
      ...(input.filtering === undefined ? {} : { filtering: input.filtering }),
      ...(input.playbackSettings === undefined
        ? {}
        : { playbackSettings: input.playbackSettings }),
      ...(input.playlistProxy === undefined
        ? {}
        : { playlistProxy: input.playlistProxy }),
      ...(input.recorded === undefined ? {} : { recorded: input.recorded }),
    });
    if (attempt !== generation) {
      if (outcome.kind === "started") {
        outcome.lease.release();
        await abandon(outcome.session.sessionId);
      }
      return { kind: "cancelled" };
    }
    if (outcome.kind === "cancelled") return { kind: "cancelled" };
    if (outcome.kind === "failed") {
      refreshingSessionId = null;
      if (refreshing && presentation.presentation === "fullscreen") {
        presentation = INITIAL_PLAYER_PRESENTATION;
        void restorePortraitOrientation();
      }
      current = { failure: outcome.failure, kind: "failed", target };
      notify();
      return startResultFrom(outcome);
    }

    const sessionId = outcome.session.sessionId;
    current = {
      integration: outcome.integration,
      kind: "active",
      lease: outcome.lease,
      phase: "buffering",
      policySequence: outcome.policySequence,
      protection: input.protection.snapshot(),
      session: outcome.session,
      target,
    };
    refreshingSessionId = null;
    if (!refreshing) {
      presentation = INITIAL_PLAYER_PRESENTATION;
      muted = false;
      volume = 1;
      quality = "auto";
      qualities = ["auto"];
    }
    progress = IDLE_PROGRESS;
    adsDetected = false;
    notify();

    if (refreshing) {
      const interrupted = (): WatchStartResult | null => {
        if (attempt !== generation) return { kind: "cancelled" };
        if (
          current?.kind === "active" &&
          current.session.sessionId === sessionId
        )
          return null;
        if (current?.kind === "failed") {
          if (presentation.presentation === "fullscreen") {
            presentation = INITIAL_PLAYER_PRESENTATION;
            void restorePortraitOrientation();
            notify();
          }
          return { failure: current.failure, kind: "failed" };
        }
        return { kind: "cancelled" };
      };
      let stopped = interrupted();
      if (stopped) return stopped;

      let restoredVolume = volume;
      let volumeResult = await input.playback.setVolume(
        sessionId,
        restoredVolume,
      );
      stopped = interrupted();
      if (stopped) return stopped;
      while (volumeResult.kind === "applied" && restoredVolume !== volume) {
        restoredVolume = volume;
        volumeResult = await input.playback.setVolume(
          sessionId,
          restoredVolume,
        );
        stopped = interrupted();
        if (stopped) return stopped;
      }
      let restoredMute = muted;
      let muteResult = await input.playback.setMuted(sessionId, restoredMute);
      stopped = interrupted();
      if (stopped) return stopped;
      while (muteResult.kind === "applied" && restoredMute !== muted) {
        restoredMute = muted;
        muteResult = await input.playback.setMuted(sessionId, restoredMute);
        stopped = interrupted();
        if (stopped) return stopped;
      }
      const requestedQuality = quality;
      const qualitySequence = qualityRequestSequence;
      const qualityResult = await input.playback.setQuality(
        sessionId,
        requestedQuality,
      );
      stopped = interrupted();
      if (stopped) return stopped;
      if (
        volumeResult.kind !== "applied" ||
        muteResult.kind !== "applied" ||
        qualityResult.kind !== "listed"
      ) {
        const failure: WatchPlaybackFailure = {
          code: "PLAYBACK_UNKNOWN",
          detail: "Playback restarted but its controls could not be restored.",
          integration: outcome.integration,
          kind: "playback-failed",
          lastSuccessfulStage: "native-session-started",
          platform: target.platform,
          recovery: ["retry", "open-provider"],
        };
        current.lease.release();
        if (presentation.presentation === "fullscreen") {
          presentation = INITIAL_PLAYER_PRESENTATION;
          void restorePortraitOrientation();
        }
        current = { failure, kind: "failed", target };
        notify();
        await abandon(sessionId);
        if (attempt !== generation) return { kind: "cancelled" };
        return { failure, kind: "failed" };
      }
      if (qualitySequence === qualityRequestSequence) {
        quality = qualityResult.catalog.selected;
        qualities = qualityResult.catalog.qualities;
        notify();
      }
    }
    return startResultFrom(outcome);
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
        sameWatchTarget(cachedSnapshotTarget, target)
      ) {
        return cachedSnapshot;
      }
      cachedSnapshotTarget = target;
      cachedSnapshot =
        current && sameWatchTarget(current.target, target)
          ? toWatchState(current)
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
      const previous = presentation;
      presentation = toFullscreen(presentation);
      notify();
      if (
        previous.presentation !== "fullscreen" &&
        presentation.presentation === "fullscreen"
      ) {
        void allowFullscreenLandscapeOrientation();
      }
    },
    exitFullscreen() {
      const previous = presentation;
      presentation = fromFullscreen(presentation);
      notify();
      if (
        previous.presentation === "fullscreen" &&
        presentation.presentation !== "fullscreen"
      ) {
        void restorePortraitOrientation();
      }
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
      const sessionId = current.session.sessionId;
      const requestSequence = ++qualityRequestSequence;
      const listed = await input.playback.setQuality(sessionId, nextQuality);
      if (
        listed.kind === "listed" &&
        current?.kind === "active" &&
        current.session.sessionId === sessionId &&
        requestSequence === qualityRequestSequence
      ) {
        quality = listed.catalog.selected;
        qualities = listed.catalog.qualities;
        notify();
      }
    },
    async seekTo(positionMs) {
      if (current?.kind !== "active") return;
      await input.playback.seekTo(current.session.sessionId, positionMs);
    },
    async requestPictureInPicture(): Promise<
      FocusedPictureInPictureResult | { readonly kind: "idle" }
    > {
      if (current?.kind !== "active") return { kind: "idle" };
      const sessionId = current.session.sessionId;
      presentation = requestPictureInPicture(presentation);
      notify();
      await afterPaint();
      if (current?.kind !== "active" || current.session.sessionId !== sessionId)
        return { kind: "idle" };
      const result = await input.playback.enterPictureInPicture(sessionId);
      if (current?.kind !== "active" || current.session.sessionId !== sessionId)
        return result;
      if (result.kind === "entered") {
        if (presentation.presentation === "pip") {
          presentation = applyPictureInPictureResult(presentation, "active");
          notify();
        }
        return result;
      }
      // Expo Go and hosts without system PiP: floating mini-player is the
      // working Picture-in-Picture action. Playback continues without ending.
      if (presentation.presentation !== "pip") return result;
      presentation = {
        pip: "idle",
        presentation: "mini",
        previous: "watch",
        snapRegion: presentation.snapRegion,
      };
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
    refresh(target) {
      return startWithIntent(target, "refresh");
    },
    start(target) {
      return startWithIntent(target, "replace");
    },
    async leave(target) {
      if (!current || !sameWatchTarget(current.target, target)) return;
      await resetToReady(target);
    },
    async dismiss() {
      if (!current) return;
      await resetToReady(current.target);
    },
    async dispose() {
      generation += 1;
      const endingSessionId = refreshingSessionId;
      refreshingSessionId = null;
      if (presentation.presentation === "fullscreen") {
        void restorePortraitOrientation();
      }
      unsubscribeNative();
      unsubscribeProtection();
      listeners.clear();
      if (current?.kind === "active") {
        if (current.session.sessionId !== endingSessionId) {
          current.lease.release();
          await abandon(current.session.sessionId);
        }
      }
      current = null;
    },
  };
}
