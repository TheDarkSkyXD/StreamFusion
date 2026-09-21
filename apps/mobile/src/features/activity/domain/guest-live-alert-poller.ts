export const DEFAULT_LIVE_ALERT_POLL_INTERVAL_MS = 60_000;

export interface GuestLiveAlertPoller {
  /** Run one reconcile pass (hydrate + observe). */
  tick(): Promise<void>;
  /** Start/stop a foreground interval. Safe to call repeatedly. */
  setForeground(active: boolean): void;
  dispose(): void;
}

/**
 * Lightweight foreground go-live poller. Reuses Following hydrateLive so the
 * shared guest live-alert reconciler stays primed and does not spam on first run.
 */
export function createGuestLiveAlertPoller(options: {
  readonly hydrateLive: () => Promise<unknown>;
  readonly intervalMs?: number;
  readonly isForeground?: () => boolean;
}): GuestLiveAlertPoller {
  const intervalMs = options.intervalMs ?? DEFAULT_LIVE_ALERT_POLL_INTERVAL_MS;
  let disposed = false;
  let foreground = options.isForeground?.() ?? false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  const tick = async () => {
    if (disposed || !foreground) return;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => options.hydrateLive())
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const syncTimer = () => {
    clearTimer();
    if (disposed || !foreground) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  };

  return {
    tick,
    setForeground(active) {
      if (disposed) return;
      const next = active === true;
      if (next === foreground) return;
      foreground = next;
      if (foreground) {
        syncTimer();
        void tick();
        return;
      }
      clearTimer();
    },
    dispose() {
      disposed = true;
      foreground = false;
      clearTimer();
    },
  };
}
