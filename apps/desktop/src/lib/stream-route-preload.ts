let streamExperiencePromise: Promise<void> | undefined;
let lastPreloadOutcome: "ready" | "failed" | undefined;

interface StreamExperiencePrewarmMark {
  status: "scheduled" | "loading" | "ready" | "failed" | "cancelled";
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
}

type StreamExperienceWindow = typeof window & {
  __streamExperiencePrewarm?: StreamExperiencePrewarmMark;
};

function markNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/** Warm the Stream route and its nested chat module before an intent click. */
export function preloadStreamExperience(): Promise<void> {
  streamExperiencePromise ??= (() => {
    lastPreloadOutcome = undefined;
    return import("@/pages")
      .then((module) => module.preloadStreamPage())
      .then(() => {
        lastPreloadOutcome = "ready";
      })
      .catch(() => {
        lastPreloadOutcome = "failed";
        streamExperiencePromise = undefined;
      });
  })();
  return streamExperiencePromise;
}

/** Schedule a one-time app-shell warmup after first paint without blocking it. */
export function scheduleStreamExperienceStartupPrewarm(): () => void {
  let disposed = false;
  const mark: StreamExperiencePrewarmMark = {
    status: "scheduled",
    scheduledAt: markNow(),
  };
  (window as StreamExperienceWindow).__streamExperiencePrewarm = mark;
  const frameId = window.requestAnimationFrame(() => {
    if (disposed) return;
    mark.status = "loading";
    mark.startedAt = markNow();
    void preloadStreamExperience().then(() => {
      mark.status = lastPreloadOutcome ?? "failed";
      mark.completedAt = markNow();
    });
  });

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frameId);
    if (mark.status === "scheduled") mark.status = "cancelled";
  };
}
