import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import { createNativeNotificationRuntime } from "../domain/native-notification-runtime";
import { proofLivePayload } from "../domain/notification-entry";
import type { BackgroundSnapshot } from "../capabilities/background-live-alerts";

const follow = {
  platform: "twitch" as const,
  channelId: "71092938",
  channelLogin: "xqc",
  displayName: "xQc",
  followedAt: "2026-09-01T00:00:00.000Z",
};
const status = {
  schemaVersion: 1 as const,
  scheduled: true,
  intervalMinutes: 15 as const,
  channelCount: 1,
  lastCheckedAtMs: null,
  failure: null,
};

describe("native background runtime", () => {
  it("applies current settings when alerts are disabled during a membership read", async () => {
    let finishMembership: (value: readonly (typeof follow)[]) => void = () =>
      undefined;
    const membership = new Promise<readonly (typeof follow)[]>((resolve) => {
      finishMembership = resolve;
    });
    let reading = false;
    let preferences = DEFAULT_LIVE_NOTIFICATION_PREFERENCES;
    const configured: BackgroundSnapshot[] = [];
    const postingEnabled: boolean[] = [];
    const runtime = createNativeNotificationRuntime({
      activity: { record: async () => undefined },
      background: {
        configure: async (snapshot) => {
          configured.push(snapshot);
          return status;
        },
        status: async () => status,
        pending: async () => [],
        acknowledge: async () => undefined,
      },
      channels: { ensure: async () => undefined },
      follows: {
        listMembership: () => {
          reading = true;
          return membership;
        },
        listGuestMembership: async () => [follow],
        readNotifications: async () => preferences,
      },
      postingPolicy: {
        apply: async (policy) => {
          postingEnabled.push(policy.enabled);
        },
      },
      presenter: { present: async () => undefined },
      receipts: { initial: async () => null, subscribe: () => () => undefined },
    });
    const syncing = runtime.sync();
    await vi.waitFor(() => expect(reading).toBe(true));
    preferences = {
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      enabled: false,
      liveAlerts: false,
      toastAlerts: false,
    };
    finishMembership([follow]);
    await syncing;
    expect(configured[0]).toMatchObject({
      channels: [],
      policy: {
        historyEnabled: false,
        systemAlerts: false,
        toastAlerts: false,
      },
    });
    expect(postingEnabled).toEqual([false]);
  });

  it("records old pending Activity before acknowledging without opening a banner", async () => {
    const event = proofLivePayload("2026-09-15T12:00:00.000Z");
    const sequence: string[] = [];
    const pending = [event];
    const runtime = createNativeNotificationRuntime({
      activity: {
        async record(item) {
          sequence.push(`record:${item.eventId}`);
        },
      },
      background: {
        async configure() {
          sequence.push("configure");
          return status;
        },
        async status() {
          return status;
        },
        async pending() {
          return [...pending];
        },
        async acknowledge(ids) {
          sequence.push(`ack:${ids[0]}`);
          pending.splice(0, pending.length);
        },
      },
      channels: { ensure: async () => undefined },
      follows: {
        listMembership: async () => [follow],
        listGuestMembership: async () => [follow],
        readNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      },
      postingPolicy: { apply: async () => undefined },
      presenter: { present: async () => undefined },
      receipts: { initial: async () => null, subscribe: () => () => undefined },
    });
    const result = await runtime.sync();
    expect(sequence).toEqual([
      `record:${event.eventId}`,
      `ack:${event.eventId}`,
      "configure",
    ]);
    expect(runtime.peekBanner()).toBeNull();
    expect(result.status).toEqual(status);
    expect(result.copy).toContain("No completed phone check yet.");
  });

  it("never acknowledges when Activity persistence fails", async () => {
    const event = proofLivePayload("2026-09-15T12:00:00.000Z");
    const acknowledgements: string[] = [];
    const runtime = createNativeNotificationRuntime({
      activity: {
        async record() {
          throw new Error("storage unavailable");
        },
      },
      background: {
        async configure() {
          return status;
        },
        async status() {
          return status;
        },
        async pending() {
          return [event];
        },
        async acknowledge(ids) {
          acknowledgements.push(...ids);
        },
      },
      channels: { ensure: async () => undefined },
      follows: {
        listMembership: async () => [follow],
        listGuestMembership: async () => [follow],
        readNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      },
      postingPolicy: { apply: async () => undefined },
      presenter: { present: async () => undefined },
      receipts: { initial: async () => null, subscribe: () => () => undefined },
    });
    expect((await runtime.sync()).status).toBeNull();
    expect(acknowledgements).toEqual([]);
  });

  it("shows the last completed phone check in settings copy", async () => {
    const runtime = createNativeNotificationRuntime({
      activity: { record: async () => undefined },
      background: {
        configure: async () => ({
          ...status,
          lastCheckedAtMs: 1_789_000_000_000,
        }),
        status: async () => status,
        pending: async () => [],
        acknowledge: async () => undefined,
      },
      channels: { ensure: async () => undefined },
      follows: {
        listMembership: async () => [follow],
        listGuestMembership: async () => [follow],
        readNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      },
      postingPolicy: { apply: async () => undefined },
      presenter: { present: async () => undefined },
      receipts: { initial: async () => null, subscribe: () => () => undefined },
    });
    const copy = (await runtime.sync()).copy;
    expect(copy).toContain("Last checked ");
    expect(copy).not.toContain("No completed phone check yet.");
  });
});
