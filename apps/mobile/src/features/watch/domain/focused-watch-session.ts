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
import {
  runFocusedWatchStart,
  startResultFrom,
} from "./start-focused-watch";

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
    effective(platform: WatchTarget["platform"]): Promise<PlaybackFilterRequest>;
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
  let presentation: PlayerPresentationState = INITIAL_PLAYER_PRESENTATION;
  let muted = false;
  let volume = 1;
  let quality = "auto";
  let qualities: readonly string[] = ["auto"];
  let progress: PlaybackProgress = IDLE_PROGRESS;
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
      progress,
      quality,
      qualities,
      state: toWatchState(current) as Extract<FocusedWatchState, { kind: "active" }>,
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
    if (!current) return;
    const next = nextNativePlayback({
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
    notify();
    if (next.refreshQualities) void refreshQualities();
  }

  async function abandon(sessionId: string): Promise<void> {
    const result = await input.playback.end(sessionId);
    if (result.kind === "unavailable") return;
  }

  async function resetToReady(target: WatchTarget): Promise<void> {
    generation += 1;
    const wasFullscreen = presentation.presentation === "fullscreen";
    presentation = INITIAL_PLAYER_PRESENTATION;
    if (wasFullscreen) {
      void restorePortraitOrientation();
    }
    if (current?.kind === "active") {
      const sessionId = current.session.sessionId;
      current.lease.release();
      current = { kind: "ready", target };
      notify();
      await abandon(sessionId);
      return;
    }
    current = { kind: "ready", target };
    notify();
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
      if (previous.presentation !== "fullscreen" && presentation.presentation === "fullscreen") {
        void allowFullscreenLandscapeOrientation();
      }
    },
    exitFullscreen() {
      const previous = presentation;
      presentation = fromFullscreen(presentation);
      notify();
      if (previous.presentation === "fullscreen" && presentation.presentation !== "fullscreen") {
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
    async seekTo(positionMs) {
      if (current?.kind !== "active") return;
      await input.playback.seekTo(current.session.sessionId, positionMs);
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
      // Expo Go and hosts without system PiP: floating mini-player is the
      // working Picture-in-Picture action. Playback continues without ending.
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
      if (outcome.kind === "cancelled") return { kind: "cancelled" };
      if (outcome.kind === "failed") {
        current = { failure: outcome.failure, kind: "failed", target };
        notify();
        return startResultFrom(outcome);
      }
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
      presentation = INITIAL_PLAYER_PRESENTATION;
      muted = false;
      volume = 1;
      quality = "auto";
      qualities = ["auto"];
      progress = IDLE_PROGRESS;
      notify();
      return startResultFrom(outcome);
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
      if (presentation.presentation === "fullscreen") {
        void restorePortraitOrientation();
      }
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
