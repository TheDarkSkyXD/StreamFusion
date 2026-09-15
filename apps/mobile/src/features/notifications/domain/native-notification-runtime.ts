import {
  buildLiveNotificationProjection,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";

import type {
  InAppNotificationBanner,
  NativeNotificationDependencies,
  NativeNotificationRuntime,
  NativeRegistrationSnapshot,
  NotificationOpenLocation,
} from "../capabilities/native-notifications";
import { nativeRegistrationSnapshot } from "./native-registration-status";
import {
  activityItemFromPayload,
  notificationOpenLocation,
} from "./notification-entry";

function createExclusiveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

export function createNativeNotificationRuntime(
  deps: NativeNotificationDependencies,
): NativeNotificationRuntime {
  const listeners = new Set<() => void>();
  const enqueueReceipt = createExclusiveQueue();
  let snapshot = nativeRegistrationSnapshot({
    fingerprint: null,
    state: "idle",
  });
  let banner: InAppNotificationBanner | null = null;
  let projectionVersion = 1;
  let started = false;
  let openHandler: ((location: NotificationOpenLocation) => void) | null =
    null;

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function setSnapshot(next: {
    readonly fingerprint: string | null;
    readonly state: NativeRegistrationSnapshot["state"];
  }): NativeRegistrationSnapshot {
    snapshot = nativeRegistrationSnapshot(next);
    notify();
    return snapshot;
  }

  function open(location: NotificationOpenLocation): void {
    openHandler?.(location);
  }

  function applyReceipt(input: {
    readonly foreground: boolean;
    readonly payload: SafeNotificationPayload;
  }): Promise<void> {
    return enqueueReceipt(() => applyReceiptNow(input));
  }

  async function applyReceiptNow(input: {
    readonly foreground: boolean;
    readonly payload: SafeNotificationPayload;
  }): Promise<void> {
    const item = activityItemFromPayload(input.payload);
    if (item) await deps.activity.record(item);
    const location = notificationOpenLocation(input.payload);
    if (input.foreground) {
      banner = {
        eventId: input.payload.eventId,
        title: input.payload.title,
        body: input.payload.body,
        location,
      };
      notify();
      return;
    }
    open(location);
  }

  async function deniedSnapshot(): Promise<NativeRegistrationSnapshot | null> {
    if ((await deps.permission()) !== "denied") return null;
    return setSnapshot({ fingerprint: null, state: "denied" });
  }

  async function registerProjection(
    token: string,
  ): Promise<NativeRegistrationSnapshot> {
    const [membership, preferences] = await Promise.all([
      deps.follows.listMembership(),
      deps.follows.readNotifications(),
    ]);
    const grant = await deps.transport.register({
      nativeToken: token,
      projection: buildLiveNotificationProjection({
        membership,
        preferences,
        version: projectionVersion,
      }),
      remoteDeliveryEnabled: preferences.enabled && preferences.liveAlerts,
    });
    if (grant === null) {
      return setSnapshot({ fingerprint: null, state: "unavailable" });
    }
    projectionVersion = grant.projectionVersion + 1;
    return setSnapshot({
      fingerprint: grant.tokenFingerprint,
      state: "registered",
    });
  }

  async function registerToken(
    token: string | null,
  ): Promise<NativeRegistrationSnapshot> {
    const denied = await deniedSnapshot();
    if (denied) return denied;
    setSnapshot({ fingerprint: snapshot.fingerprint, state: "pending" });
    await deps.channels.ensure();
    if (token === null || !(await deps.identityReady())) {
      return setSnapshot({ fingerprint: null, state: "unavailable" });
    }
    return registerProjection(token);
  }

  async function registerCurrentToken(): Promise<NativeRegistrationSnapshot> {
    const denied = await deniedSnapshot();
    if (denied) return denied;
    await deps.channels.ensure();
    return registerToken(await deps.tokens.read());
  }

  function ensureStarted(): void {
    if (started) return;
    started = true;
    deps.receipts.subscribe((receipt) => {
      void applyReceipt(receipt);
    });
    deps.tokens.subscribe((token) => {
      void registerToken(token);
    });
    void deps.receipts.initial().then((payload) => {
      if (payload) open(notificationOpenLocation(payload));
    });
    void registerCurrentToken();
  }

  return {
    bindOpen(handler) {
      openHandler = handler;
    },
    dismissBanner() {
      banner = null;
      notify();
    },
    load: registerCurrentToken,
    peek: () => snapshot,
    peekBanner: () => banner,
    async presentProof(payload) {
      await deps.channels.ensure();
      await applyReceipt({ foreground: true, payload });
      try {
        await deps.presenter.present(payload);
      } catch {
        return;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureStarted();
      return () => {
        listeners.delete(listener);
      };
    },
    sync: registerCurrentToken,
  };
}
