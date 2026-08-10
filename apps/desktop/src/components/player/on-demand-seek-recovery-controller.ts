const PRESENTED_FRAME_TOLERANCE_SECONDS = 1;
const MEANINGFUL_PROGRESS_SECONDS = 0.05;
const RECOVERY_THRESHOLDS = [
  { stage: "soft", elapsedMs: 2_500 },
  { stage: "hard", elapsedMs: 5_500 },
  { stage: "terminal", elapsedMs: 7_500 },
] as const;

export type OnDemandSeekRecoveryStage = (typeof RECOVERY_THRESHOLDS)[number]["stage"];

export interface OnDemandSeekRecovery {
  generation: number;
  targetSeconds: number;
  stage: OnDemandSeekRecoveryStage;
}

export interface OnDemandSeekRecoveryControllerOptions {
  onRecovery: (recovery: OnDemandSeekRecovery) => void;
  onSuccess?: (success: OnDemandSeekSuccess) => void;
  scheduleRecovery?: OnDemandSeekRecoveryScheduler;
}

export type OnDemandSeekRecoveryScheduler = (
  delayMs: number,
  callback: () => void
) => OnDemandSeekRecoveryTimer;

interface OnDemandSeekRecoveryTimer {
  cancel(): boolean;
}

export interface OnDemandSeekSuccess {
  generation: number;
  targetSeconds: number;
  presentedSeconds: number;
}

const scheduleWithNativeTimer: OnDemandSeekRecoveryScheduler = (delayMs, callback) => {
  let settled = false;
  // timer-allowlist: seek-recovery stages must run synchronously in the deadline macrotask
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    callback();
  }, delayMs);

  return {
    cancel: () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      return true;
    },
  };
};

export class OnDemandSeekRecoveryController {
  private generation = 0;
  private targetSeconds: number | null = null;
  private bestPresentedDistance: number | null = null;
  private readonly firedStages = new Set<OnDemandSeekRecoveryStage>();
  private readonly recoveryTimers = new Map<OnDemandSeekRecoveryStage, OnDemandSeekRecoveryTimer>();
  private readonly scheduleRecovery: OnDemandSeekRecoveryScheduler;

  constructor(private readonly options: OnDemandSeekRecoveryControllerOptions) {
    this.scheduleRecovery = options.scheduleRecovery ?? scheduleWithNativeTimer;
  }

  commitSeek(targetSeconds: number): number {
    const generation = ++this.generation;
    this.targetSeconds = targetSeconds;
    this.clearRecoveryTimers();
    this.firedStages.clear();
    this.bestPresentedDistance = null;
    this.schedulePendingStages(generation, targetSeconds);

    return generation;
  }

  /** Completes the latest seek when its presented media time is within +/- 1.0s of the target. */
  notePresentedFrame(generation: number, presentedSeconds: number): void {
    if (generation !== this.generation || this.targetSeconds === null) return;

    const distance = Math.abs(presentedSeconds - this.targetSeconds);
    if (distance > PRESENTED_FRAME_TOLERANCE_SECONDS) {
      if (this.bestPresentedDistance === null) {
        this.bestPresentedDistance = distance;
      } else if (
        this.bestPresentedDistance - distance + Number.EPSILON >=
        MEANINGFUL_PROGRESS_SECONDS
      ) {
        this.bestPresentedDistance = distance;
        this.rescheduleProgressSensitiveStages(generation, this.targetSeconds);
      }
      return;
    }

    const targetSeconds = this.targetSeconds;
    this.targetSeconds = null;
    this.bestPresentedDistance = null;
    this.clearRecoveryTimers();
    this.options.onSuccess?.({ generation, targetSeconds, presentedSeconds });
  }

  cancel(): void {
    this.targetSeconds = null;
    this.bestPresentedDistance = null;
    this.firedStages.clear();
    this.clearRecoveryTimers();
  }

  private schedulePendingStages(
    generation: number,
    targetSeconds: number,
    includeTerminal = true
  ): void {
    RECOVERY_THRESHOLDS.forEach(({ stage, elapsedMs }) => {
      if (!includeTerminal && stage === "terminal") return;
      if (this.firedStages.has(stage)) return;

      const timer = this.scheduleRecovery(elapsedMs, () => {
        this.recoveryTimers.delete(stage);
        if (generation !== this.generation || targetSeconds !== this.targetSeconds) return;

        this.firedStages.add(stage);
        if (stage === "terminal") {
          this.targetSeconds = null;
          this.bestPresentedDistance = null;
          this.clearRecoveryTimers();
        }
        this.options.onRecovery({ generation, targetSeconds, stage });
      });
      this.recoveryTimers.set(stage, timer);
    });
  }

  private rescheduleProgressSensitiveStages(generation: number, targetSeconds: number): void {
    RECOVERY_THRESHOLDS.forEach(({ stage }) => {
      if (stage === "terminal") return;

      const timer = this.recoveryTimers.get(stage);
      timer?.cancel();
      this.recoveryTimers.delete(stage);
    });

    this.schedulePendingStages(generation, targetSeconds, false);
  }

  private clearRecoveryTimers(): void {
    this.recoveryTimers.forEach((timer) => timer.cancel());
    this.recoveryTimers.clear();
  }
}
