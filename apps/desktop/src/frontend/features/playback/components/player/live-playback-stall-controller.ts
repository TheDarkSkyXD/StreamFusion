export interface LivePlaybackSnapshot {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  hidden: boolean;
  online: boolean;
  readyState: number;
  bufferedAheadSeconds: number;
  adBlockHolding: boolean;
  videoFrameCallbacksSupported: boolean;
  lastPresentedFrameAt: number | null;
}

export type LivePlaybackStallReason = "input-starved" | "decoder-stall";

export type LivePlaybackStallAction =
  | { type: "start-load"; stage: "soft" | "hard"; reason: "input-starved" }
  | { type: "nudge"; stage: "soft"; reason: "decoder-stall" }
  | { type: "recover-media"; stage: "hard"; reason: "decoder-stall" }
  | { type: "fatal"; stage: "exhausted"; reason: LivePlaybackStallReason };

export type LivePlaybackStallPhase =
  "startup" | "healthy" | "suspect" | "soft" | "hard" | "exhausted";

export interface LivePlaybackStallTransition {
  from: LivePlaybackStallPhase;
  to: LivePlaybackStallPhase;
  reason: LivePlaybackStallReason | "source-reset" | "progress";
  elapsedMs: number;
}

const SOFT_RECOVERY_MS = 2_500;
const HARD_RECOVERY_MS = 5_500;
const FATAL_RECOVERY_MS = 7_500;
const STARTUP_SOFT_RECOVERY_MS = 10_000;
const STARTUP_HARD_RECOVERY_MS = 16_000;
const STARTUP_FATAL_RECOVERY_MS = 22_000;
const SEEK_GRACE_MS = 2_500;
const HEALTHY_RESET_MS = 2_000;
const FRESH_FRAGMENT_MS = 3_000;
const FRESH_PRESENTED_FRAME_MS = 1_500;
const MIN_BUFFERED_AHEAD_SECONDS = 0.25;
const MIN_PROGRESS_SECONDS = 0.01;
const HAVE_FUTURE_DATA = 3;

export class LivePlaybackStallController {
  private phase: LivePlaybackStallPhase = "startup";
  private armed = false;
  private expectedToPlay = false;
  private hasStartedPlayback = false;
  private waiting = false;
  private stalled = false;
  private networkError = false;
  private incidentStartedAt: number | null = null;
  private incidentReason: LivePlaybackStallReason | null = null;
  private startupIncident = false;
  private fragmentLoadedAt: number | null = null;
  private manifestParsedAt: number | null = null;
  private lastPresentedFrameAt: number | null = null;
  private lastPresentedMediaTime = 0;
  private seekGraceUntil = 0;
  private lastCurrentTime = 0;
  private healthyProgressStartedAt: number | null = null;

  constructor(private readonly onTransition?: (transition: LivePlaybackStallTransition) => void) {}

  resetSource(_generation: number, _now: number, currentTime: number): void {
    this.armed = false;
    this.expectedToPlay = false;
    this.hasStartedPlayback = false;
    this.waiting = false;
    this.stalled = false;
    this.networkError = false;
    this.incidentStartedAt = null;
    this.incidentReason = null;
    this.startupIncident = false;
    this.fragmentLoadedAt = null;
    this.manifestParsedAt = null;
    this.lastPresentedFrameAt = null;
    this.lastPresentedMediaTime = currentTime;
    this.seekGraceUntil = 0;
    this.lastCurrentTime = currentTime;
    this.healthyProgressStartedAt = null;
    this.transitionTo("startup", "source-reset", 0);
  }

  notePlay(_now?: number, currentTime?: number): void {
    this.expectedToPlay = true;
    if (currentTime !== undefined) this.lastCurrentTime = currentTime;
  }

  notePlaying(now: number, currentTime: number): void {
    this.expectedToPlay = true;
    this.armed = true;
    this.hasStartedPlayback = true;
    this.lastCurrentTime = currentTime;
    this.clearSignals();
    if (this.phase !== "startup" && this.phase !== "healthy" && this.phase !== "exhausted") {
      this.healthyProgressStartedAt ??= now;
    }
  }

  notePause(): void {
    this.expectedToPlay = false;
    this.clearSignals();
    this.clearIncident();
  }

  noteEnded(): void {
    this.expectedToPlay = false;
    this.armed = false;
    this.clearSignals();
    this.clearIncident();
  }

  noteWaiting(now: number): void {
    this.waiting = true;
    this.startIncidentIfArmed(now);
  }

  noteStalled(now: number): void {
    this.stalled = true;
    this.startIncidentIfArmed(now);
  }

  noteNetworkError(now: number): void {
    this.networkError = true;
    this.startIncidentIfArmed(now);
  }

  noteFragmentLoaded(now: number): void {
    this.fragmentLoadedAt = now;
    this.networkError = false;
  }

  noteManifestParsed(now: number): void {
    this.manifestParsedAt = now;
    this.armed = true;
    this.expectedToPlay = true;
  }

  notePresentedFrame(now: number, mediaTime: number): void {
    if (mediaTime + MIN_PROGRESS_SECONDS < this.lastPresentedMediaTime) return;
    this.lastPresentedFrameAt = now;
    this.lastPresentedMediaTime = mediaTime;
  }

  noteRecoveryNudge(currentTime: number): void {
    this.lastCurrentTime = currentTime;
  }

  noteSeeking(_now: number): void {
    this.clearSignals();
    this.clearIncident();
  }

  noteSeeked(now: number, currentTime: number): void {
    this.lastCurrentTime = currentTime;
    this.seekGraceUntil = now + SEEK_GRACE_MS;
    this.clearSignals();
    this.clearIncident();
  }

  noteVisibilityChange(_now: number, currentTime: number): void {
    this.lastCurrentTime = currentTime;
    this.lastPresentedFrameAt = null;
    this.lastPresentedMediaTime = currentTime;
    this.clearSignals();
    this.clearIncident();
  }

  noteConnectivityChange(_now: number, currentTime: number): void {
    this.lastCurrentTime = currentTime;
    this.lastPresentedFrameAt = null;
    this.lastPresentedMediaTime = currentTime;
    this.clearSignals();
    this.clearIncident();
  }

  evaluate(now: number, snapshot: LivePlaybackSnapshot): LivePlaybackStallAction | null {
    const currentTimeAdvanced = snapshot.currentTime > this.lastCurrentTime + MIN_PROGRESS_SECONDS;
    const hasFreshPresentedFrame =
      !snapshot.videoFrameCallbacksSupported ||
      (snapshot.lastPresentedFrameAt !== null &&
        now - snapshot.lastPresentedFrameAt <= FRESH_PRESENTED_FRAME_MS);
    if (currentTimeAdvanced && hasFreshPresentedFrame) {
      this.recordProgress(now, snapshot.currentTime);
      return null;
    }

    if (this.isSuppressed(now, snapshot)) {
      this.clearIncident();
      return null;
    }

    if (!this.armed || !this.expectedToPlay || this.phase === "exhausted") return null;

    const reason = this.classifyStall(now, snapshot);
    if (!reason) {
      this.clearIncident();
      return null;
    }

    if (this.incidentStartedAt === null) {
      this.startupIncident = this.phase === "startup" && !this.hasStartedPlayback;
      this.incidentStartedAt =
        snapshot.videoFrameCallbacksSupported && snapshot.lastPresentedFrameAt !== null
          ? Math.min(now, snapshot.lastPresentedFrameAt)
          : now;
      this.incidentReason = reason;
      this.transitionTo("suspect", reason, 0);
      if (this.incidentStartedAt === now) return null;
    }
    if (this.incidentReason === null) {
      this.incidentReason = reason;
      this.transitionTo("suspect", reason, 0);
    } else if (this.incidentReason !== reason) {
      this.incidentStartedAt = now;
      this.incidentReason = reason;
      this.transitionTo("suspect", reason, 0);
      return null;
    }

    const elapsedMs = now - this.incidentStartedAt;
    const deferPendingStartupRead =
      this.startupIncident && reason === "input-starved" && !this.networkError;
    const softRecoveryMs = deferPendingStartupRead
      ? STARTUP_SOFT_RECOVERY_MS
      : SOFT_RECOVERY_MS;
    const hardRecoveryMs = deferPendingStartupRead
      ? STARTUP_HARD_RECOVERY_MS
      : HARD_RECOVERY_MS;
    const fatalRecoveryMs = deferPendingStartupRead
      ? STARTUP_FATAL_RECOVERY_MS
      : FATAL_RECOVERY_MS;
    if (elapsedMs >= fatalRecoveryMs) {
      this.transitionTo("exhausted", reason, elapsedMs);
      return { type: "fatal", stage: "exhausted", reason };
    }
    if (elapsedMs >= hardRecoveryMs && this.phase !== "hard") {
      this.transitionTo("hard", reason, elapsedMs);
      return reason === "decoder-stall"
        ? { type: "recover-media", stage: "hard", reason }
        : { type: "start-load", stage: "hard", reason };
    }
    if (elapsedMs >= softRecoveryMs && this.phase === "suspect") {
      this.transitionTo("soft", reason, elapsedMs);
      return reason === "decoder-stall"
        ? { type: "nudge", stage: "soft", reason }
        : { type: "start-load", stage: "soft", reason };
    }
    return null;
  }

  private startIncidentIfArmed(now: number): void {
    if (!this.armed || !this.expectedToPlay || this.phase === "exhausted") return;
    if (this.incidentStartedAt === null) {
      this.startupIncident = this.phase === "startup" && !this.hasStartedPlayback;
      this.incidentStartedAt = now;
    }
  }

  private classifyStall(
    now: number,
    snapshot: LivePlaybackSnapshot
  ): LivePlaybackStallReason | null {
    const hasPlaybackSignal = this.waiting || this.stalled;
    const hasEnoughBuffer =
      snapshot.readyState >= HAVE_FUTURE_DATA &&
      snapshot.bufferedAheadSeconds >= MIN_BUFFERED_AHEAD_SECONDS;
    const hasFreshFragment =
      this.fragmentLoadedAt !== null && now - this.fragmentLoadedAt <= FRESH_FRAGMENT_MS;

    if (hasEnoughBuffer && hasFreshFragment) return "decoder-stall";
    if (this.fragmentLoadedAt !== null && !hasFreshFragment) return "input-starved";
    if (
      this.fragmentLoadedAt === null &&
      this.manifestParsedAt !== null &&
      now - this.manifestParsedAt >= FRESH_FRAGMENT_MS
    ) {
      return "input-starved";
    }
    if (!hasEnoughBuffer && (hasPlaybackSignal || this.networkError)) return "input-starved";
    return null;
  }

  private isSuppressed(now: number, snapshot: LivePlaybackSnapshot): boolean {
    return (
      snapshot.paused ||
      snapshot.ended ||
      snapshot.seeking ||
      snapshot.adBlockHolding ||
      !snapshot.online ||
      snapshot.hidden ||
      now < this.seekGraceUntil
    );
  }

  private recordProgress(now: number, currentTime: number): void {
    this.armed = true;
    this.expectedToPlay = true;
    this.hasStartedPlayback = true;
    this.lastCurrentTime = currentTime;
    this.clearSignals();
    this.clearIncident();

    if (this.phase === "healthy" || this.phase === "startup") {
      this.healthyProgressStartedAt = now;
      this.transitionTo("healthy", "progress", 0);
      return;
    }

    this.healthyProgressStartedAt ??= now;
    if (now - this.healthyProgressStartedAt >= HEALTHY_RESET_MS) {
      this.transitionTo("healthy", "progress", now - this.healthyProgressStartedAt);
      this.healthyProgressStartedAt = now;
    }
  }

  private clearSignals(): void {
    this.waiting = false;
    this.stalled = false;
    this.networkError = false;
  }

  private clearIncident(): void {
    this.incidentStartedAt = null;
    this.incidentReason = null;
    this.startupIncident = false;
  }

  private transitionTo(
    next: LivePlaybackStallPhase,
    reason: LivePlaybackStallTransition["reason"],
    elapsedMs: number
  ): void {
    if (next === this.phase) return;
    const from = this.phase;
    this.phase = next;
    this.onTransition?.({ from, to: next, reason, elapsedMs });
  }
}
