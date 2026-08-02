import { createManagedInterval } from "@/lib/managed-interval";
import { sleep } from "@/lib/sleep";

export type ConnectivityStatus = "checking" | "online" | "offline";

export interface NetworkStatusSnapshot {
  status: ConnectivityStatus;
  confirmedStatus: ConnectivityStatus;
  isOnline: boolean;
  isOffline: boolean;
  isChecking: boolean;
  nextRetryAt: number | null;
  retryInSeconds: number | null;
  recoveryCount: number;
}

interface NetworkStatusStoreDependencies {
  probe: () => Promise<boolean>;
  eventTarget: Pick<Window, "addEventListener" | "removeEventListener"> | EventTarget;
  readBrowserOnline: () => boolean;
}

export interface NetworkStatusStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NetworkStatusSnapshot;
  checkNow(): Promise<boolean>;
  setDebugOverride(isOnline: boolean | null): void;
}

const RETRY_DELAYS_MS = [5_000, 10_000, 15_000, 30_000] as const;

export function createNetworkStatusStore({
  probe,
  eventTarget,
  readBrowserOnline,
}: NetworkStatusStoreDependencies): NetworkStatusStore {
  const listeners = new Set<() => void>();
  let confirmedStatus: ConnectivityStatus = readBrowserOnline() ? "checking" : "offline";
  let debugOverride: boolean | null = null;
  let failureCount = 0;
  let recoveryCount = 0;
  let checking = false;
  let nextRetryAt: number | null = null;
  let retryScheduleGeneration = 0;
  let countdownTimer: { stop: () => void } | null = null;
  let inFlight: Promise<boolean> | null = null;
  let onlineRecheckRequested = false;
  let checkGeneration = 0;
  let started = false;

  let snapshot = createSnapshot();

  function createSnapshot(): NetworkStatusSnapshot {
    const status: ConnectivityStatus =
      debugOverride === null ? confirmedStatus : debugOverride ? "online" : "offline";
    return {
      status,
      confirmedStatus,
      isOnline: status !== "offline",
      isOffline: status === "offline",
      isChecking: checking || confirmedStatus === "checking",
      nextRetryAt: confirmedStatus === "offline" ? nextRetryAt : null,
      retryInSeconds:
        confirmedStatus === "offline" && nextRetryAt !== null
          ? Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1_000))
          : null,
      recoveryCount,
    };
  }

  function emit(): void {
    snapshot = createSnapshot();
    for (const listener of listeners) listener();
  }

  function clearRetrySchedule(): void {
    retryScheduleGeneration += 1;
    countdownTimer?.stop();
    countdownTimer = null;
    nextRetryAt = null;
  }

  function scheduleRetry(): void {
    clearRetrySchedule();
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(failureCount - 1, 0), 3)];
    const retryGeneration = retryScheduleGeneration;
    nextRetryAt = Date.now() + delay;
    void sleep(delay).then(() => {
      if (retryGeneration !== retryScheduleGeneration) return;
      nextRetryAt = null;
      void checkNow();
    });
    countdownTimer = createManagedInterval(emit, 1_000);
    emit();
  }

  function applyProbeResult(reachable: boolean): void {
    checking = false;
    if (reachable) {
      const recovered = confirmedStatus === "offline";
      confirmedStatus = "online";
      failureCount = 0;
      if (recovered) recoveryCount += 1;
      clearRetrySchedule();
      emit();
      return;
    }

    confirmedStatus = "offline";
    failureCount += 1;
    scheduleRetry();
  }

  function checkNow(): Promise<boolean> {
    if (inFlight) return inFlight;
    clearRetrySchedule();
    checking = true;
    emit();
    const generation = ++checkGeneration;
    const pending = probe()
      .catch(() => false)
      .then((reachable) => {
        // Release the single-flight latch before notifying subscribers. A
        // subscriber may synchronously react to the offline transition by
        // requesting another check; it must not receive this completed probe.
        if (inFlight === pending) inFlight = null;
        const isCurrent = generation === checkGeneration;
        if (isCurrent) {
          const shouldRecheck = onlineRecheckRequested && !reachable && started;
          onlineRecheckRequested = false;
          applyProbeResult(reachable);
          if (shouldRecheck) void checkNow();
        }
        return reachable;
      });
    inFlight = pending;
    return pending;
  }

  function onBrowserOffline(): void {
    checkGeneration += 1;
    inFlight = null;
    onlineRecheckRequested = false;
    checking = false;
    confirmedStatus = "offline";
    failureCount = Math.max(failureCount, 1);
    scheduleRetry();
  }

  function onBrowserOnline(): void {
    if (inFlight) {
      // Coalesce repeated browser hints, but do not let an outage-era probe
      // consume the only signal that a network link just returned.
      onlineRecheckRequested = true;
      return;
    }
    void checkNow();
  }

  function start(): void {
    if (started) return;
    started = true;
    eventTarget.addEventListener("online", onBrowserOnline);
    eventTarget.addEventListener("offline", onBrowserOffline);
    if (readBrowserOnline()) {
      void checkNow();
    } else {
      onBrowserOffline();
    }
  }

  function stop(): void {
    if (!started) return;
    started = false;
    eventTarget.removeEventListener("online", onBrowserOnline);
    eventTarget.removeEventListener("offline", onBrowserOffline);
    checkGeneration += 1;
    inFlight = null;
    onlineRecheckRequested = false;
    checking = false;
    clearRetrySchedule();
    snapshot = createSnapshot();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot() {
      return snapshot;
    },
    checkNow,
    setDebugOverride(isOnline) {
      debugOverride = isOnline;
      emit();
    },
  };
}

function getWindow(): Window | undefined {
  return (globalThis as unknown as { window?: Window }).window;
}

async function probeConnectivity(): Promise<boolean> {
  const w = getWindow();
  if (!w) return true;
  const check = w.electronAPI?.connectivity?.check;
  if (!check) return w.navigator.onLine;
  const result = await check();
  return result.reachable;
}

const windowTarget = getWindow();

export const networkStatusStore = createNetworkStatusStore({
  probe: probeConnectivity,
  eventTarget: windowTarget ?? new EventTarget(),
  readBrowserOnline: () => windowTarget?.navigator.onLine ?? true,
});
