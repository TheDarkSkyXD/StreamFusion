import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  type GuestFollow,
} from "@streamfusion/core/follows";
import type { ActivityItem } from "@streamfusion/core/activity";
import {
  fingerprintNativePushToken,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";

import type {
  NativeNotificationDependencies,
  NativePushTransport,
  NotificationOpenLocation,
} from "../capabilities/native-notifications";
import { createNativeNotificationRuntime } from "../domain/native-notification-runtime";
import { proofLivePayload } from "../domain/notification-entry";

const nativeToken =
  "dK3kExampleFcmTokenValue:APA91bProofTokenWithoutSecrets0123456789";

function dependencies(input?: {
  readonly beforeApply?: () => Promise<void>;
  readonly beforeRegister?: () => Promise<void>;
  readonly permission?: "granted" | "denied" | "unavailable";
  readonly token?: string | null;
}): {
  readonly activity: ActivityItem[];
  readonly emitReceipt: (input: {
    readonly payload: SafeNotificationPayload;
    readonly foreground: boolean;
  }) => void;
  readonly emitToken: (token: string) => void;
  readonly opened: NotificationOpenLocation[];
  readonly policies: { readonly enabled: boolean; readonly sound: boolean }[];
  readonly presented: SafeNotificationPayload[];
  readonly registered: string[];
  readonly requests: Parameters<NativePushTransport["register"]>[0][];
  readonly runtime: ReturnType<typeof createNativeNotificationRuntime>;
  readonly setPermission: (value: "granted" | "denied" | "unavailable") => void;
  readonly setMembership: (value: readonly GuestFollow[]) => void;
  readonly setToken: (value: string | null) => void;
  readonly setPreferences: (
    value: typeof DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  ) => void;
  readonly sequence: string[];
  readonly tokenReads: number;
  readonly disabled: number;
} {
  const activity: ActivityItem[] = [];
  const opened: NotificationOpenLocation[] = [];
  const presented: SafeNotificationPayload[] = [];
  const registered: string[] = [];
  const requests: Parameters<NativePushTransport["register"]>[0][] = [];
  const policies: { readonly enabled: boolean; readonly sound: boolean }[] = [];
  const sequence: string[] = [];
  const listeners: ((token: string) => void)[] = [];
  const receiptListeners: ((input: {
    payload: SafeNotificationPayload;
    foreground: boolean;
  }) => void)[] = [];
  let tokenReads = 0;
  let disabled = 0;
  let permission = input?.permission ?? "granted";
  let currentToken = input?.token === undefined ? nativeToken : input.token;
  let preferences = DEFAULT_LIVE_NOTIFICATION_PREFERENCES;
  let membership: readonly GuestFollow[] = [
    {
      platform: "twitch",
      channelId: "chan-1",
      channelLogin: "proofstreamer",
      displayName: "ProofStreamer",
      followedAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  const deps: NativeNotificationDependencies = {
    activity: {
      async record(item) {
        activity.push(item);
      },
    },
    channels: {
      async ensure() {
        sequence.push("channels");
      },
    },
    follows: {
      listMembership: async () => membership,
      readNotifications: async () => preferences,
    },
    identityReady: async () => currentToken !== null,
    permission: async () => permission,
    postingPolicy: {
      async apply(value) {
        policies.push(value);
        await input?.beforeApply?.();
      },
    },
    presenter: {
      async present(payload) {
        presented.push(payload);
      },
    },
    receipts: {
      initial: async () => null,
      subscribe(listener) {
        receiptListeners.push(listener);
        return () => undefined;
      },
    },
    tokens: {
      async read() {
        sequence.push("token");
        tokenReads += 1;
        return currentToken;
      },
      subscribe(listener) {
        listeners.push(listener);
        return () => undefined;
      },
    },
    transport: {
      disable: async () => {
        disabled += 1;
        return true;
      },
      async register(request) {
        registered.push(request.nativeToken);
        requests.push(request);
        await input?.beforeRegister?.();
        return {
          registered: true,
          tokenFingerprint: await fingerprintNativePushToken(
            request.nativeToken,
          ),
          projectionVersion: request.projection.version,
          topicSubscriptions: request.remoteDeliveryEnabled
            ? request.projection.pairs.length
            : 0,
          overflowPairs: 0,
          reconciledAt: "2026-09-15T12:00:00.000Z",
        };
      },
    },
  };
  const runtime = createNativeNotificationRuntime(deps);
  runtime.bindOpen((location) => {
    opened.push(location);
  });
  return {
    activity,
    emitReceipt: (receipt) => {
      receiptListeners.forEach((listener) => listener(receipt));
    },
    emitToken: (token) => {
      listeners.forEach((listener) => listener(token));
    },
    get tokenReads() {
      return tokenReads;
    },
    opened,
    policies,
    presented,
    registered,
    requests,
    runtime,
    setPermission: (value) => {
      permission = value;
    },
    setMembership: (value) => {
      membership = value;
    },
    setToken: (value) => {
      currentToken = value;
    },
    setPreferences: (value) => {
      preferences = value;
    },
    sequence,
    get disabled() {
      return disabled;
    },
  };
}

// Guards: FCM token rotation upserts without Expo Push; denial keeps Activity; ended proof opens channel
describe("native notification runtime", () => {
  it("registers a native FCM token fingerprint and rotates without Expo Push", async () => {
    const { registered, runtime } = dependencies();
    const first = await runtime.sync();
    expect(first.state).toBe("registered");
    expect(first.fingerprint).toBe(
      await fingerprintNativePushToken(nativeToken),
    );
    expect(first.topicSubscriptions).toBe(1);
    expect(first.overflowPairs).toBe(0);
    expect(first.copy).toMatch(/registered for background delivery/i);
    expect(registered).toEqual([nativeToken]);
    const rotated = `${nativeToken}Rotated`;
    const { registered: again, runtime: next } = dependencies({
      token: rotated,
    });
    const second = await next.sync();
    expect(second.fingerprint).toBe(await fingerprintNativePushToken(rotated));
    expect(again).toEqual([rotated]);
    expect(JSON.stringify(second)).not.toContain(rotated);
  });

  it("keeps Activity writable when posting is denied or FCM is unavailable", async () => {
    const denied = dependencies({ permission: "denied" });
    expect((await denied.runtime.sync()).state).toBe("denied");
    const missing = dependencies({ token: null });
    expect((await missing.runtime.sync()).state).toBe("unavailable");
    expect(missing.policies).toEqual([{ enabled: true, sound: true }]);
    const payload = proofLivePayload("2026-09-15T12:00:00.000Z");
    await denied.runtime.presentProof(payload);
    expect(denied.activity[0]?.eventId).toBe(payload.eventId);
    expect(denied.runtime.peekBanner()?.location).toEqual({
      kind: "watch",
      platform: "twitch",
      channelId: "71092938",
      channelLogin: "xqc",
    });
  });

  it("creates Android channels before reading the native FCM token", async () => {
    const { sequence, runtime } = dependencies();
    await runtime.sync();
    expect(sequence.indexOf("channels")).toBeLessThan(
      sequence.indexOf("token"),
    );
  });

  it("reconciles saved preferences and posting policy after an initial registration", async () => {
    const harness = dependencies();
    await harness.runtime.sync();
    harness.setPreferences({
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      doNotDisturb: true,
      sound: false,
    });
    await harness.runtime.sync();
    expect(
      harness.requests.map((request) => request.remoteDeliveryEnabled),
    ).toEqual([true, false]);
    expect(harness.policies).toEqual([
      { enabled: true, sound: true },
      { enabled: false, sound: false },
    ]);
  });

  it("sends updated followed channels after registration", async () => {
    const harness = dependencies();
    await harness.runtime.sync();
    harness.setMembership([
      {
        platform: "kick",
        channelId: "chan-2",
        channelLogin: "spreen",
        displayName: "Spreen",
        followedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    await harness.runtime.sync();
    expect(
      harness.requests.map((request) =>
        request.projection.pairs.map((pair) => pair.channelId),
      ),
    ).toEqual([["chan-1"], ["chan-2"]]);
  });

  it("retires an enabled remote registration when Android permission is denied", async () => {
    const harness = dependencies();
    await harness.runtime.sync();
    harness.setPermission("denied");
    const denied = await harness.runtime.sync();
    expect(denied.state).toBe("denied");
    expect(harness.disabled).toBe(1);
    expect(harness.policies.at(-1)).toEqual({ enabled: false, sound: true });
  });

  it("still retires remote delivery when Android alert policy cannot be applied", async () => {
    const harness = dependencies({
      permission: "denied",
      beforeApply: async () => {
        throw new Error("native policy unavailable");
      },
    });
    expect((await harness.runtime.sync()).state).toBe("denied");
    expect(harness.disabled).toBe(1);
  });

  it("serializes overlapping registrations and sends the latest saved choices last", async () => {
    let releaseFirst: (() => void) | undefined;
    let started = 0;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const harness = dependencies({
      beforeRegister: async () => {
        started += 1;
        if (started === 1) await firstBlocked;
      },
    });
    const first = harness.runtime.sync();
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    harness.setPreferences({
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      enabled: false,
    });
    const second = harness.runtime.sync();
    await Promise.resolve();
    expect(harness.requests).toHaveLength(1);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(
      harness.requests.map((request) => [
        request.projection.version,
        request.remoteDeliveryEnabled,
      ]),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it("reports a registration failure and can retry without losing local settings", async () => {
    let fail = true;
    const harness = dependencies({
      beforeRegister: async () => {
        if (fail) {
          fail = false;
          throw new Error("network unavailable");
        }
      },
    });
    expect((await harness.runtime.sync()).state).toBe("unavailable");
    harness.setPreferences({
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      sound: false,
    });
    expect((await harness.runtime.sync()).state).toBe("registered");
    expect(harness.policies.at(-1)).toEqual({ enabled: true, sound: false });
  });

  it("registers a listener token without reading getDevicePushTokenAsync again", async () => {
    const harness = dependencies();
    harness.runtime.subscribe(() => undefined);
    await vi.waitFor(() => {
      expect(harness.registered).toEqual([nativeToken]);
    });
    const reads = harness.tokenReads;
    const rotated = `${nativeToken}Rotated`;
    harness.emitToken(rotated);
    await vi.waitFor(() => {
      expect(harness.registered).toContain(rotated);
    });
    expect(harness.tokenReads).toBe(reads);
  });

  it("refreshes the native token on sync after a rotation without a JS event", async () => {
    const harness = dependencies();
    await harness.runtime.sync();
    const rotated = `${nativeToken}Rotated`;
    harness.setToken(rotated);
    await harness.runtime.sync();
    expect(harness.registered).toEqual([nativeToken, rotated]);
  });

  it("opens Watch for a background live alert and the channel page when it has ended", async () => {
    const harness = dependencies();
    harness.runtime.subscribe(() => undefined);
    const live = {
      ...proofLivePayload("2026-09-15T12:00:00.000Z"),
      eventId: "live:twitch:chan-1:live",
      destination: {
        kind: "watch-channel" as const,
        platform: "twitch" as const,
        channelId: "chan-1",
        channelLogin: "proofstreamer",
        streamState: "live" as const,
      },
    };
    harness.emitReceipt({ foreground: false, payload: live });
    await vi.waitFor(() => {
      expect(harness.opened[0]).toEqual({
        kind: "watch",
        platform: "twitch",
        channelId: "chan-1",
        channelLogin: "proofstreamer",
      });
    });
    harness.emitReceipt({
      foreground: false,
      payload: {
        ...proofLivePayload("2026-09-15T12:00:01.000Z"),
        eventId: "live:twitch:chan-1:ended",
        destination: {
          kind: "watch-channel" as const,
          platform: "twitch" as const,
          channelId: "chan-1",
          channelLogin: "proofstreamer",
          streamState: "ended" as const,
        },
      },
    });
    await vi.waitFor(() => {
      expect(harness.opened[1]).toEqual({
        kind: "channel",
        platform: "twitch",
        id: "chan-1",
        username: "proofstreamer",
      });
    });
  });

  it("shows the in-app banner even when local presentation fails", async () => {
    const payload = proofLivePayload("2026-09-15T12:00:02.000Z");
    const activity: ActivityItem[] = [];
    const runtime = createNativeNotificationRuntime({
      activity: {
        async record(item) {
          activity.push(item);
        },
      },
      channels: { ensure: async () => undefined },
      follows: {
        listMembership: async () => [],
        readNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      },
      identityReady: async () => false,
      permission: async () => "granted",
      postingPolicy: { apply: async () => undefined },
      presenter: {
        async present() {
          throw new Error("Play Services is missing");
        },
      },
      receipts: {
        initial: async () => null,
        subscribe: () => () => undefined,
      },
      tokens: {
        read: async () => null,
        subscribe: () => () => undefined,
      },
      transport: {
        disable: async () => true,
        register: async () => null,
      },
    });
    await expect(runtime.presentProof(payload)).resolves.toBeUndefined();
    expect(activity[0]?.eventId).toBe(payload.eventId);
    expect(runtime.peekBanner()?.eventId).toBe(payload.eventId);
  });

  it("records Activity receipts one at a time", async () => {
    let active = 0;
    let maxActive = 0;
    const activity: ActivityItem[] = [];
    const receiptListeners: ((input: {
      payload: SafeNotificationPayload;
      foreground: boolean;
    }) => void)[] = [];
    const runtime = createNativeNotificationRuntime({
      activity: {
        async record(item) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await Promise.resolve();
          activity.push(item);
          active -= 1;
        },
      },
      channels: { ensure: async () => undefined },
      follows: {
        listMembership: async () => [],
        readNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      },
      identityReady: async () => false,
      permission: async () => "granted",
      postingPolicy: { apply: async () => undefined },
      presenter: {
        async present(payload) {
          receiptListeners.forEach((listener) =>
            listener({ foreground: true, payload }),
          );
        },
      },
      receipts: {
        initial: async () => null,
        subscribe(listener) {
          receiptListeners.push(listener);
          return () => undefined;
        },
      },
      tokens: {
        read: async () => null,
        subscribe: () => () => undefined,
      },
      transport: {
        disable: async () => true,
        register: async () => null,
      },
    });
    runtime.subscribe(() => undefined);
    const payload = proofLivePayload("2026-09-15T12:00:03.000Z");
    await runtime.presentProof(payload);
    expect(maxActive).toBe(1);
    expect(activity.map((item) => item.eventId)).toEqual([
      payload.eventId,
      payload.eventId,
    ]);
    expect(runtime.peekBanner()?.eventId).toBe(payload.eventId);
  });
});
