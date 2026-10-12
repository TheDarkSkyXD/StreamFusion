import {
  buildLiveNotificationProjection,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";
import type { LiveNotificationPreferences } from "@streamfusion/core/follows";

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
  const enqueueRegistration = createExclusiveQueue();
  let snapshot = nativeRegistrationSnapshot({
    fingerprint: null,
    state: "idle",
  });
  let banner: InAppNotificationBanner | null = null;
  let projectionVersion = 1;
  let started = false;
  let openHandler: ((location: NotificationOpenLocation) => void) | null = null;

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function setSnapshot(next: {
    readonly fingerprint: string | null;
    readonly lastFailure?: string | null;
    readonly overflowPairs?: number;
    readonly state: NativeRegistrationSnapshot["state"];
    readonly topicSubscriptions?: number;
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

  async function registerProjection(
    token: string,
    preferences: LiveNotificationPreferences,
    policyFailure: string | null,
  ): Promise<NativeRegistrationSnapshot> {
    const membership = await deps.follows.listMembership();
    const grant = await deps.transport.register({
      nativeToken: token,
      projection: buildLiveNotificationProjection({
        membership,
        preferences,
        version: projectionVersion,
      }),
      remoteDeliveryEnabled:
        preferences.enabled &&
        preferences.liveAlerts &&
        !preferences.doNotDisturb,
    });
    if (grant === null) {
      return setSnapshot({
        fingerprint: null,
        lastFailure: policyFailure,
        state: "unavailable",
      });
    }
    projectionVersion = grant.projectionVersion + 1;
    return setSnapshot({
      fingerprint: grant.tokenFingerprint,
      overflowPairs: grant.overflowPairs,
      lastFailure: policyFailure,
      state: "registered",
      topicSubscriptions: grant.topicSubscriptions,
    });
  }

  async function registerTokenNow(
    token: string | null,
  ): Promise<NativeRegistrationSnapshot> {
    const [preferences, permission] = await Promise.all([
      deps.follows.readNotifications(),
      deps.permission(),
    ]);
    let policyFailure: string | null = null;
    try {
      await deps.postingPolicy.apply({
        enabled:
          permission === "granted" &&
          preferences.enabled &&
          preferences.liveAlerts &&
          !preferences.doNotDisturb,
        sound: preferences.sound,
      });
    } catch {
      policyFailure =
        "Android alert settings could not be applied on this device.";
    }
    if (permission === "denied") {
      let disabled = false;
      try {
        disabled = await deps.transport.disable();
      } catch {
        disabled = false;
      }
      return setSnapshot({
        fingerprint: null,
        state: "denied",
        lastFailure: disabled
          ? policyFailure
          : "Android blocked notifications. Remote alert registration could not be retired yet.",
      });
    }
    setSnapshot({ fingerprint: snapshot.fingerprint, state: "pending" });
    if (token === null || !(await deps.identityReady())) {
      return setSnapshot({
        fingerprint: null,
        lastFailure: policyFailure,
        state: "unavailable",
      });
    }
    return registerProjection(token, preferences, policyFailure);
  }

  function registerToken(token?: string): Promise<NativeRegistrationSnapshot> {
    return enqueueRegistration(async () => {
      try {
        await deps.channels.ensure();
        return await registerTokenNow(token ?? (await deps.tokens.read()));
      } catch {
        return setSnapshot({
          fingerprint: null,
          lastFailure:
            "Remote alert registration failed. Your notification settings remain saved on this device.",
          state: "unavailable",
        });
      }
    });
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
    void registerToken();
  }

  return {
    bindOpen(handler) {
      openHandler = handler;
    },
    dismissBanner() {
      banner = null;
      notify();
    },
    load: () => registerToken(),
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
    sync: () => registerToken(),
  };
}
