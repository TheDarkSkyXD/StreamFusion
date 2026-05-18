/**
 * U23 — Per-channel OS-notification throttle for AutoMod alerts.
 *
 * Plan decision #7 caps OS notifications at 1 per 30s per channel. The first
 * enqueue for a channel fires immediately and opens a 30s window; subsequent
 * enqueues within that window accumulate a per-channel pending count and
 * remember the latest preview. When the window expires, ONE aggregate
 * notification fires reading "N held messages on <channel>" — or nothing if
 * no follow-on holds arrived.
 *
 * Lives in `backend/services` for symmetry with the existing renderer-side
 * services (`mod-log-writer`, etc.). Electron's renderer can hit
 * `globalThis.Notification` directly; no preload bridge is required today.
 * If a future hardening pass disables `nodeIntegration` and removes
 * `Notification` from the renderer, this module documents the gap rather
 * than crashing.
 */

export interface OSNotificationThrottleOptions {
  /** Min ms between firings per channel. Default = 30_000. */
  windowMs?: number;
  /** Injectable Notification constructor — undefined in headless tests. */
  notificationCtor?: typeof Notification;
}

interface ChannelWindow {
  /** Latest preview text observed during the window. Used when count > 1. */
  latestPreview: string;
  /** Latest channel display name (kept up-to-date with the most recent enqueue). */
  channelName: string;
  /** Number of enqueues OBSERVED since the window opened, INCLUDING the
   *  first one that fired immediately. */
  totalSinceOpen: number;
  /** setTimeout id for the window-close aggregate fire. */
  timer: ReturnType<typeof setTimeout>;
}

export class OSNotificationThrottle {
  private readonly windowMs: number;
  private readonly notificationCtor: typeof Notification | undefined;
  private readonly windows: Map<string, ChannelWindow> = new Map();
  /** Track whether we already asked for permission this session so we don't
   *  spam `requestPermission` on every enqueue when the user dismissed it. */
  private permissionRequested = false;

  constructor(opts?: OSNotificationThrottleOptions) {
    this.windowMs = opts?.windowMs ?? 30_000;
    this.notificationCtor =
      opts?.notificationCtor ??
      (typeof globalThis !== "undefined" &&
      typeof (globalThis as { Notification?: typeof Notification }).Notification !==
        "undefined"
        ? (globalThis as { Notification: typeof Notification }).Notification
        : undefined);
  }

  enqueue(input: {
    channelId: string;
    channelName: string;
    preview: string;
  }): void {
    const { channelId, channelName, preview } = input;
    const open = this.windows.get(channelId);
    if (open) {
      // Within the 30s window: accumulate, do not fire.
      open.totalSinceOpen += 1;
      open.latestPreview = preview;
      open.channelName = channelName;
      return;
    }
    // Fresh window — fire the single-message notification immediately and
    // start a 30s timer for the aggregate close.
    const firstFired = this.fireSingle(channelName, preview);
    if (!firstFired) {
      // Permission denied or no Notification API available. Don't open a
      // window because nothing will fire on close either; this keeps the
      // throttle a silent no-op in unsupported environments.
      return;
    }
    const timer = setTimeout(() => this.closeWindow(channelId), this.windowMs);
    this.windows.set(channelId, {
      latestPreview: preview,
      channelName,
      totalSinceOpen: 1,
      timer,
    });
  }

  __flushForTesting(): void {
    for (const w of this.windows.values()) {
      clearTimeout(w.timer);
    }
    this.windows.clear();
  }

  __resetForTesting(): void {
    this.__flushForTesting();
    this.permissionRequested = false;
  }

  // ---- internals ------------------------------------------------------------

  /** Fire one Notification, respecting permission. Returns true if it fired
   *  (or was scheduled after a permission grant), false otherwise. */
  private fireSingle(channelName: string, preview: string): boolean {
    return this.fire(`Held message on ${channelName}`, preview);
  }

  private fireAggregate(channelName: string, count: number): boolean {
    return this.fire(
      `${count} held messages on ${channelName}`,
      "Open AutoMod to review.",
    );
  }

  private fire(title: string, body: string): boolean {
    const Ctor = this.notificationCtor;
    if (!Ctor) return false;
    const perm = Ctor.permission;
    if (perm === "granted") {
      try {
        new Ctor(title, { body });
        return true;
      } catch {
        return false;
      }
    }
    if (perm === "denied") return false;
    // "default" — request once, then try again on the next enqueue. We don't
    // chain the constructor inside the promise resolution because the first
    // alert is best-effort; the next hold in the same window will fire if
    // the user grants permission.
    if (!this.permissionRequested && typeof Ctor.requestPermission === "function") {
      this.permissionRequested = true;
      try {
        const result = Ctor.requestPermission();
        // Some implementations return void + emit a global event; others
        // return a Promise. Best-effort: if we get a Promise that resolves
        // to "granted", fire the notification then.
        if (result && typeof (result as Promise<NotificationPermission>).then === "function") {
          (result as Promise<NotificationPermission>).then((p) => {
            if (p === "granted") {
              try {
                new Ctor(title, { body });
              } catch {
                /* ignore */
              }
            }
          });
        }
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  private closeWindow(channelId: string): void {
    const w = this.windows.get(channelId);
    if (!w) return;
    this.windows.delete(channelId);
    // The first enqueue already fired. Only fire the aggregate if MORE
    // arrived during the window — totalSinceOpen counts the first one.
    if (w.totalSinceOpen > 1) {
      this.fireAggregate(w.channelName, w.totalSinceOpen);
    }
  }
}

/** Process-wide singleton used by `useAutoModAlerts`. Tests construct their
 *  own instance via the class to avoid leaking state across the suite. */
export const osNotificationThrottle = new OSNotificationThrottle();
