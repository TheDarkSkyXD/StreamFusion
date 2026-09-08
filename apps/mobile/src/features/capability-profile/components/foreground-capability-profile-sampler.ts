import type { RuntimeDegradationStage } from "../domain/capability-profile";

export type ScheduledTimer = ReturnType<typeof setTimeout>;

export interface ForegroundCapabilityProfileSampler {
  dispose(): void;
  refresh(): void;
  start(): void;
}

export interface ForegroundCapabilityProfileSamplerOptions {
  readonly cancel: (timer: ScheduledTimer) => void;
  readonly degradedIntervalMs: number;
  readonly isForeground: () => boolean;
  readonly normalIntervalMs: number;
  readonly onSampleStart?: () => void;
  readonly runSample: () => Promise<RuntimeDegradationStage>;
  readonly schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly subscribe: (onForegroundChange: (foreground: boolean) => void) => {
    remove(): void;
  };
}

export function createForegroundCapabilityProfileSampler(
  options: ForegroundCapabilityProfileSamplerOptions,
): ForegroundCapabilityProfileSampler {
  let disposed = false;
  let foreground = options.isForeground();
  let inFlight = false;
  let timer: ScheduledTimer | undefined;
  const clearTimer = () => {
    if (timer !== undefined) options.cancel(timer);
    timer = undefined;
  };
  const sample = async () => {
    if (disposed || !foreground || inFlight) return;
    inFlight = true;
    options.onSampleStart?.();
    try {
      const stage = await options.runSample();
      if (disposed || !foreground) return;
      timer = options.schedule(
        () => void sample(),
        stage === 0 ? options.normalIntervalMs : options.degradedIntervalMs,
      );
    } finally {
      inFlight = false;
    }
  };
  const subscription = options.subscribe((nextForeground) => {
    foreground = nextForeground;
    clearTimer();
    if (foreground) void sample();
  });
  return {
    dispose() {
      disposed = true;
      clearTimer();
      subscription.remove();
    },
    refresh() {
      clearTimer();
      void sample();
    },
    start() {
      void sample();
    },
  };
}
