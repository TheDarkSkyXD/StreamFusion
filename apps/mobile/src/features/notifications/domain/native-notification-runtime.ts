import type { SafeNotificationPayload } from "@streamfusion/core/relay";

import type {
  InAppNotificationBanner,
  NativeNotificationDependencies,
  NativeNotificationRuntime,
  NativeNotificationSnapshot,
  NotificationOpenLocation,
} from "../capabilities/native-notifications";
import type { ForegroundObservation, BackgroundStatus } from "../capabilities/background-live-alerts";
import { buildBackgroundSnapshot } from "./background-live-alerts";
import { activityItemFromPayload, notificationOpenLocation } from "./notification-entry";

function createExclusiveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
}

function statusCopy(status: BackgroundStatus | null): string {
  if (status === null) return "Phone background checks are unavailable. Saved notification choices remain on this device.";
  if (status.failure === "inbox-full") return "Background Activity is full. Open Activity to import pending alerts.";
  if (status.failure === "storage-unavailable") return "Phone background checks cannot use secure storage right now.";
  if (status.failure === "provider-unavailable") return "The last phone check could not reach a provider. It will retry.";
  if (!status.scheduled) return "Phone background checks are off for the current follows and settings.";
  const lastChecked = status.lastCheckedAtMs === null
    ? "No completed phone check yet."
    : `Last checked ${new Date(status.lastCheckedAtMs).toLocaleString()}.`;
  return `This phone checks ${status.channelCount} followed channel${status.channelCount === 1 ? "" : "s"} about every 15 minutes, even when the app is closed. Android may delay checks. Force-stopping the app pauses them until you reopen it. ${lastChecked}`;
}

export function createNativeNotificationRuntime(deps: NativeNotificationDependencies): NativeNotificationRuntime {
  const listeners = new Set<() => void>();
  const enqueue = createExclusiveQueue();
  let snapshot: NativeNotificationSnapshot = { status: null, copy: "Checking phone background checks." };
  let banner: InAppNotificationBanner | null = null;
  let started = false;
  let openHandler: ((location: NotificationOpenLocation) => void) | null = null;

  function notify() { listeners.forEach((listener) => listener()); }
  function setStatus(status: BackgroundStatus | null) {
    snapshot = { status, copy: statusCopy(status) };
    notify();
    return snapshot;
  }
  async function importPending(): Promise<readonly SafeNotificationPayload[]> {
    const pending = await deps.background.pending();
    for (const payload of pending) {
      const item = activityItemFromPayload(payload);
      if (item === null) continue;
      await deps.activity.record(item);
      await deps.background.acknowledge([payload.eventId]);
    }
    return pending;
  }
  async function syncNow(observations: readonly ForegroundObservation[]): Promise<NativeNotificationSnapshot> {
    try {
      const before = new Set((await importPending()).map((event) => event.eventId));
      const [membership, guestMembership] = await Promise.all([
        deps.follows.listMembership(),
        deps.follows.listGuestMembership(),
      ]);
      await deps.channels.ensure();
      const preferences = await deps.follows.readNotifications();
      await deps.postingPolicy.apply({
        enabled: preferences.enabled && !preferences.doNotDisturb,
        sound: preferences.sound,
      });
      const status = await deps.background.configure(buildBackgroundSnapshot({
        membership, guestMembership, preferences, observations,
      }));
      const after = await importPending();
      if (observations.length > 0 && preferences.toastAlerts && !preferences.doNotDisturb) {
        const observedChannels = new Set(observations.filter((observation) => observation.kind === "live")
          .map((observation) => `${observation.platform}:${observation.channelId}`));
        const fresh = after.find((event) => !before.has(event.eventId) &&
          event.destination.kind === "watch-channel" &&
          observedChannels.has(`${event.destination.platform}:${event.destination.channelId}`));
        if (fresh) {
          banner = {
            eventId: fresh.eventId,
            title: fresh.title,
            body: fresh.body,
            location: notificationOpenLocation(fresh),
          };
          notify();
        }
      }
      return setStatus(status);
    } catch {
      return setStatus(null);
    }
  }
  function ensureStarted() {
    if (started) return;
    started = true;
    deps.receipts.subscribe(({ payload, foreground }) => {
      if (!foreground) openHandler?.(notificationOpenLocation(payload));
    });
    void deps.receipts.initial().then((payload) => {
      if (payload) openHandler?.(notificationOpenLocation(payload));
    });
    void enqueue(() => syncNow([]));
  }
  return {
    bindOpen(handler) { openHandler = handler; },
    dismissBanner() { banner = null; notify(); },
    load: () => enqueue(() => syncNow([])),
    peek: () => snapshot,
    peekBanner: () => banner,
    async presentProof(payload) {
      await deps.channels.ensure();
      const item = activityItemFromPayload(payload);
      if (item) await deps.activity.record(item);
      banner = { eventId: payload.eventId, title: payload.title, body: payload.body,
        location: notificationOpenLocation(payload) };
      notify();
      try { await deps.presenter.present(payload); } catch { return; }
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureStarted();
      return () => { listeners.delete(listener); };
    },
    sync: (observations = []) => enqueue(() => syncNow(observations)),
  };
}
