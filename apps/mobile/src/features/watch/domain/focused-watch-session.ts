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
import { prepareWatchSourceAttempts } from "./start-focused-watch";
import { resolveWatchSource } from "./watch-source-resolution";

const RECOVERY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;

type SourceRecovery = {
  readonly sessionId: string;
  readonly interruptionId: number;
  readonly generation: number;
  attempt: number;
  run: number;
  retryAtMs: number | null;
  controller: AbortController | null;
  busy: boolean;
  awaitingReady: boolean;
};

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
  let recovery: SourceRecovery | null = null;
  let playIntent = true;
  let sourceCandidateIndex = 0;
  let presentation: PlayerPresentationState = INITIAL_PLAYER_PRESENTATION;
  let muted = false;
  let volume = 1;
  let quality = "auto";
  let qualityPreference = "auto";
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
  function applyPresentation(next: PlayerPresentationState): boolean {
    if (next === presentation) return false;
    const previous = presentation;
    presentation = next;
    if (
      next.presentation === "fullscreen" &&
      previous.presentation !== "fullscreen"
    ) {
      void allowFullscreenLandscapeOrientation();
    } else if (
      (previous.presentation === "fullscreen" && next.presentation !== "pip") ||
      (previous.presentation === "pip" && next.presentation !== "pip")
    ) {
      void restorePortraitOrientation();
    }
    return true;
  }
  const unsubscribeNative = input.playback.subscribe((event) => {
    applyNativeEvent(event);
  });
  const unsubscribeProtection = input.protection.subscribe(() => {
    if (current?.kind === "active") {
      current = { ...current, protection: input.protection.snapshot() };
      notify();
    }
  });

  function stopRecoveryWork(record: SourceRecovery): void {
    record.run += 1;
    record.retryAtMs = null;
    record.controller?.abort();
    record.controller = null;
    record.busy = false;
  }

  function cancelRecovery(): void {
    if (recovery) stopRecoveryWork(recovery);
    recovery = null;
  }

  function recoveryIsCurrent(record: SourceRecovery, run: number): boolean {
    return (
      recovery === record &&
      record.run === run &&
      record.generation === generation &&
      current?.kind === "active" &&
      current.session.sessionId === record.sessionId
    );
  }

  function finishRecovery(failure: WatchPlaybackFailure): void {
    const active = current;
    if (active?.kind !== "active") return;
    cancelRecovery();
    active.lease.release();
    applyPresentation(INITIAL_PLAYER_PRESENTATION);
    current = { failure, kind: "failed", target: active.target };
    notify();
    void abandon(active.session.sessionId);
  }

  function scheduleRecovery(record: SourceRecovery): void {
    if (
      !playIntent ||
      record.retryAtMs !== null ||
      record.busy ||
      record.awaitingReady
    )
      return;
    const delay =
      RECOVERY_DELAYS_MS[
        Math.min(record.attempt, RECOVERY_DELAYS_MS.length - 1)
      ] ?? 15_000;
    record.retryAtMs = Date.now() + delay;
  }

  function recoverWhenDue(record: SourceRecovery): void {
    if (record.retryAtMs === null || Date.now() < record.retryAtMs) return;
    record.retryAtMs = null;
    void recoverSource(record);
  }

  async function recoverSource(record: SourceRecovery): Promise<void> {
    if (
      !recoveryIsCurrent(record, record.run) ||
      !playIntent ||
      !input.playback.recoverSource
    )
      return;
    const run = ++record.run;
    record.busy = true;
    const controller = new AbortController();
    record.controller = controller;
    const active = current;
    if (active?.kind !== "active") return;
    const stillCurrent = () =>
      recoveryIsCurrent(record, run) &&
      !controller.signal.aborted &&
      playIntent;
    try {
      const policy = await input.policy.read(active.target.platform);
      if (!stillCurrent()) return;
      if (policy.kind === "disabled") {
        finishRecovery({
          integration: active.integration,
          kind: "compatibility-disabled",
          lastSuccessfulStage: "none",
          platform: active.target.platform,
          reason: policy.reason,
          recovery: ["refresh-policy", "open-provider"],
        });
        return;
      }
      const resolved = await resolveWatchSource(
        input.sources,
        input.recorded,
        active.target,
        controller.signal,
      );
      if (!stillCurrent()) return;
      if (resolved.kind === "unavailable") {
        const sourceFailure = resolved.failure;
        if (
          sourceFailure.kind === "cancelled" ||
          sourceFailure.kind === "offline" ||
          (sourceFailure.kind === "provider-rejected" &&
            (sourceFailure.status === 408 ||
              sourceFailure.status === 429 ||
              (sourceFailure.status >= 500 && sourceFailure.status <= 599)))
        ) {
          record.attempt += 1;
          record.busy = false;
          record.controller = null;
          scheduleRecovery(record);
          return;
        }
        finishRecovery({
          code: sourceFailure.kind,
          detail: sourceFailure.detail,
          integration: active.integration,
          kind: "source-unavailable",
          lastSuccessfulStage: "policy-authorized",
          platform: active.target.platform,
          recovery: ["retry", "open-provider"],
        });
        return;
      }
      const attempts = await prepareWatchSourceAttempts(
        {
          target: active.target,
          ...(input.filtering === undefined
            ? {}
            : { filtering: input.filtering }),
          ...(input.playlistProxy === undefined
            ? {}
            : { playlistProxy: input.playlistProxy }),
        },
        resolved,
      );
      if (!stillCurrent()) return;
      const source =
        attempts[Math.min(sourceCandidateIndex, attempts.length - 1)];
      if (!source) {
        finishRecovery({
          code: "invalid-response",
          detail: "No playback source is available.",
          integration: active.integration,
          kind: "source-unavailable",
          lastSuccessfulStage: "policy-authorized",
          platform: active.target.platform,
          recovery: ["retry", "open-provider"],
        });
        return;
      }
      record.awaitingReady = true;
      const result = await input.playback.recoverSource({
        ...source,
        interruptionId: record.interruptionId,
        sessionId: record.sessionId,
      });
      if (!stillCurrent() && recovery === record && result.kind !== "applied") {
        record.awaitingReady = false;
        scheduleRecovery(record);
        return;
      }
      if (!stillCurrent()) return;
      if (result.kind !== "applied") {
        finishRecovery({
          detail:
            result.kind === "unavailable"
              ? result.failure.detail
              : "The playback session ended.",
          integration: active.integration,
          kind: "native-unavailable",
          lastSuccessfulStage: "source-resolved",
          platform: active.target.platform,
          recovery: ["retry", "open-provider"],
        });
        return;
      }
      record.busy = false;
      record.controller = null;
    } catch {
      if (!stillCurrent() && recovery === record && record.awaitingReady) {
        record.awaitingReady = false;
        scheduleRecovery(record);
        return;
      }
      if (!stillCurrent()) return;
      finishRecovery({
        code: "invalid-response",
        detail: "The stream source could not be resolved.",
        integration: active.integration,
        kind: "source-unavailable",
        lastSuccessfulStage: "policy-authorized",
        platform: active.target.platform,
        recovery: ["retry", "open-provider"],
      });
    }
  }

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
    if (
      current?.kind !== "active" ||
      current.session.sessionId !== event.sessionId
    )
      return;
    if (event.kind === "source-recovery-required") {
      if (
        current.kind !== "active" ||
        current.target.media ||
        current.session.sessionId !== event.sessionId ||
        !input.playback.recoverSource
      )
        return;
      if (
        recovery?.interruptionId === event.interruptionId &&
        recovery.sessionId === event.sessionId
      )
        return;
      const attempt =
        recovery?.sessionId === event.sessionId ? recovery.attempt + 1 : 0;
      cancelRecovery();
      sourceCandidateIndex += 1;
      recovery = {
        sessionId: event.sessionId,
        interruptionId: event.interruptionId,
        generation,
        attempt,
        run: 0,
        retryAtMs: null,
        controller: null,
        busy: false,
        awaitingReady: false,
      };
      current = { ...current, phase: playIntent ? "buffering" : "paused" };
      notify();
      scheduleRecovery(recovery);
      return;
    }
    if (event.kind === "source-recovered") {
      if (
        recovery?.sessionId === event.sessionId &&
        recovery.interruptionId === event.interruptionId
      ) {
        cancelRecovery();
        sourceCandidateIndex = 0;
      }
      return;
    }
    if (recovery && recovery.sessionId === event.sessionId) {
      if (event.kind === "progress") recoverWhenDue(recovery);
      if (event.kind === "paused") {
        playIntent = false;
        stopRecoveryWork(recovery);
        if (current.kind === "active") {
          current = { ...current, phase: "paused" };
          notify();
        }
      }
      if (
        event.kind === "playing" ||
        event.kind === "paused" ||
        event.kind === "buffering"
      )
        return;
    }
    if (event.kind === "paused") playIntent = false;
    if (event.kind === "playing") playIntent = true;
    const next = nextNativePlayback({
      adsDetected,
      current,
      event,
      presentation,
      progress,
    });
    if (next.kind === "ignore") return;
    if (next.current.kind !== "active") cancelRecovery();
    if (next.releaseLease && current.kind === "active") {
      current.lease.release();
    }
    current = next.current;
    applyPresentation(
      next.current.kind === "active"
        ? next.presentation
        : INITIAL_PLAYER_PRESENTATION,
    );
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
    cancelRecovery();
    generation += 1;
    const endingSessionId = refreshingSessionId;
    refreshingSessionId = null;
    applyPresentation(INITIAL_PLAYER_PRESENTATION);
    adsDetected = false;
    progress = IDLE_PROGRESS;
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

    cancelRecovery();
    playIntent = true;

    const attempt = ++generation;
    if (!refreshing) applyPresentation(INITIAL_PLAYER_PRESENTATION);
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
      applyPresentation(INITIAL_PLAYER_PRESENTATION);
      current = { failure: outcome.failure, kind: "failed", target };
      notify();
      return startResultFrom(outcome);
    }

    const sessionId = outcome.session.sessionId;
    sourceCandidateIndex = outcome.candidateIndex;
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
      applyPresentation(INITIAL_PLAYER_PRESENTATION);
      muted = false;
      volume = 1;
      quality = "auto";
      qualityPreference = input.playbackSettings?.snapshot().quality ?? "auto";
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
          if (applyPresentation(INITIAL_PLAYER_PRESENTATION)) notify();
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
      const requestedQuality = qualityPreference;
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
        applyPresentation(INITIAL_PLAYER_PRESENTATION);
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
    async readPlaybackObservation() {
      if (current?.kind !== "active" || !input.playback.readPlaybackObservation)
        return {
          kind: "unavailable",
          failure: {
            code: "OPERATION_UNSUPPORTED",
            detail: "No playback observations are available.",
          },
        };
      const sessionId = current.session.sessionId;
      const result = await input.playback.readPlaybackObservation(sessionId);
      if (current?.kind !== "active" || current.session.sessionId !== sessionId)
        return {
          kind: "unavailable",
          failure: {
            code: "INVOCATION_FAILED",
            detail: "The playback session changed.",
          },
        };
      return result;
    },
    async setPlaybackSpeed(speed) {
      if (
        current?.kind !== "active" ||
        !current.target.media ||
        !input.playback.setPlaybackSpeed
      )
        return {
          kind: "unavailable",
          failure: {
            code: "OPERATION_UNSUPPORTED",
            detail: "Playback speed is available for recorded media only.",
          },
        };
      const sessionId = current.session.sessionId;
      const result = await input.playback.setPlaybackSpeed(sessionId, speed);
      if (current?.kind !== "active" || current.session.sessionId !== sessionId)
        return {
          kind: "unavailable",
          failure: {
            code: "INVOCATION_FAILED",
            detail: "The playback session changed.",
          },
        };
      return result;
    },
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
      if (!applyPresentation(next)) return;
      notify();
    },
    reveal() {
      const next = revealInWatch(presentation);
      if (!applyPresentation(next)) return;
      notify();
    },
    relocateMiniPlayer(region: MiniPlayerSnapRegion) {
      applyPresentation(moveMini(presentation, region));
      notify();
    },
    enterFullscreen() {
      applyPresentation(toFullscreen(presentation));
      notify();
    },
    exitFullscreen() {
      applyPresentation(fromFullscreen(presentation));
      notify();
    },
    async setPlaying(playing) {
      if (current?.kind !== "active") return;
      const sessionId = current.session.sessionId;
      playIntent = playing;
      if (!playing && recovery) stopRecoveryWork(recovery);
      if (playing && recovery) scheduleRecovery(recovery);
      if (recovery) {
        current = { ...current, phase: playing ? "buffering" : "paused" };
        notify();
      }
      await input.playback.setPlaying(sessionId, playing);
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
      const changingQuality = nextQuality !== quality;
      const listed = await (!changingQuality
        ? input.playback.listQualities(sessionId)
        : input.playback.setQuality(sessionId, nextQuality));
      if (
        listed.kind === "listed" &&
        current?.kind === "active" &&
        current.session.sessionId === sessionId &&
        requestSequence === qualityRequestSequence
      ) {
        if (changingQuality) qualityPreference = nextQuality;
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
      applyPresentation(requestPictureInPicture(presentation));
      notify();
      await afterPaint();
      if (current?.kind !== "active" || current.session.sessionId !== sessionId)
        return { kind: "idle" };
      const result = await input.playback.enterPictureInPicture(sessionId);
      if (current?.kind !== "active" || current.session.sessionId !== sessionId)
        return result;
      if (result.kind === "entered") {
        if (presentation.presentation === "pip") {
          applyPresentation(
            applyPictureInPictureResult(presentation, "active"),
          );
          notify();
        }
        return result;
      }
      // Keep playback in the floating mini-player when system PiP is unavailable.
      if (presentation.presentation !== "pip") return result;
      applyPresentation({
        pip: "idle",
        presentation: "mini",
        previous: "watch",
        snapRegion: presentation.snapRegion,
      });
      notify();
      return result;
    },
    restoreFromPictureInPicture() {
      if (presentation.pip !== "active" && presentation.pip !== "requesting") {
        return;
      }
      applyPresentation(returnFromPictureInPicture(presentation));
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
      cancelRecovery();
      generation += 1;
      const endingSessionId = refreshingSessionId;
      refreshingSessionId = null;
      applyPresentation(INITIAL_PLAYER_PRESENTATION);
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
