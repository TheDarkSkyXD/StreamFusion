import { describe, expect, it, vi } from "vitest";

import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";
import type { ActivityItem } from "@streamfusion/core/activity";
import {
  fingerprintNativePushToken,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";

import type {
  NativeNotificationDependencies,
  NotificationOpenLocation,
} from "../capabilities/native-notifications";
import { createNativeNotificationRuntime } from "../domain/native-notification-runtime";
import { proofLivePayload } from "../domain/notification-entry";

const nativeToken =
  "dK3kExampleFcmTokenValue:APA91bProofTokenWithoutSecrets0123456789";

function dependencies(input?: {
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
  readonly presented: SafeNotificationPayload[];
  readonly registered: string[];
  readonly runtime: ReturnType<typeof createNativeNotificationRuntime>;
  readonly sequence: string[];
  readonly tokenReads: number;
} {
  const activity: ActivityItem[] = [];
  const opened: NotificationOpenLocation[] = [];
  const presented: SafeNotificationPayload[] = [];
  const registered: string[] = [];
  const sequence: string[] = [];
  const listeners: ((token: string) => void)[] = [];
  const receiptListeners: ((input: {
    payload: SafeNotificationPayload;
    foreground: boolean;
  }) => void)[] = [];
  let tokenReads = 0;
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
      listMembership: async () => [
        {
          platform: "twitch",
          channelId: "chan-1",
          channelLogin: "proofstreamer",
          displayName: "ProofStreamer",
          followedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      readNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    },
    identityReady: async () => input?.token !== null,
    permission: async () => input?.permission ?? "granted",
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
        return input?.token ?? nativeToken;
      },
      subscribe(listener) {
        listeners.push(listener);
        return () => undefined;
      },
    },
    transport: {
      disable: async () => true,
      async register(request) {
        registered.push(request.nativeToken);
        return {
          registered: true,
          tokenFingerprint: await fingerprintNativePushToken(request.nativeToken),
          projectionVersion: request.projection.version,
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
    presented,
    registered,
    runtime,
    sequence,
  };
}

// Guards: FCM token rotation upserts without Expo Push; denial keeps Activity; ended proof opens channel
describe("native notification runtime", () => {
  it("registers a native FCM token fingerprint and rotates without Expo Push", async () => {
    const { registered, runtime } = dependencies();
    const first = await runtime.sync();
    expect(first.state).toBe("registered");
    expect(first.fingerprint).toBe(await fingerprintNativePushToken(nativeToken));
    expect(registered).toEqual([nativeToken]);
    const rotated = `${nativeToken}Rotated`;
    const { registered: again, runtime: next } = dependencies({ token: rotated });
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
    const payload = proofLivePayload("2026-09-15T12:00:00.000Z");
    await denied.runtime.presentProof(payload);
    expect(denied.activity[0]?.eventId).toBe(payload.eventId);
    expect(denied.runtime.peekBanner()?.location).toEqual({
      kind: "channel",
      platform: "twitch",
      id: "proof-channel",
      username: "proofstreamer",
    });
  });

  it("creates Android channels before reading the native FCM token", async () => {
    const { sequence, runtime } = dependencies();
    await runtime.sync();
    expect(sequence.indexOf("channels")).toBeLessThan(sequence.indexOf("token"));
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
      payload: proofLivePayload("2026-09-15T12:00:01.000Z"),
    });
    await vi.waitFor(() => {
      expect(harness.opened[1]).toEqual({
        kind: "channel",
        platform: "twitch",
        id: "proof-channel",
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
