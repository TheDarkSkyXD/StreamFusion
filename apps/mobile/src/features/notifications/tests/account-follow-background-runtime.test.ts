import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import { createConfirmedAccountFollowMembership } from "@mobile/features/follows/data/confirmed-account-follow-membership";
import type {
  AccountFollowMembershipOutcome,
  AccountMembershipState,
} from "@mobile/features/follows/capabilities/account-follow-membership";
import { createFollowingRuntime } from "@mobile/features/follows/composition/following-runtime";
import { guestFollow } from "@mobile/features/follows/domain/following-fixtures";
import type { BackgroundSnapshot } from "../capabilities/background-live-alerts";
import { createNativeNotificationRuntime } from "../domain/native-notification-runtime";

vi.mock("expo-linking", () => ({ openURL: vi.fn(async () => undefined) }));

function setup() {
  const follow = guestFollow({ channelId: "123", channelLogin: "alice" });
  let outcome: AccountFollowMembershipOutcome = {
    kind: "available",
    follows: [follow],
  };
  let state: AccountMembershipState = { kind: "account", accountId: "user-a" };
  let preferences = DEFAULT_LIVE_NOTIFICATION_PREFERENCES;
  const rows = new Map<string, string>();
  const settings: ProductSettingsStore = {
    read: async (key) => rows.get(key) ?? null,
    write: async (key, value) => {
      rows.set(key, value);
    },
  };
  const snapshots: BackgroundSnapshot[] = [];
  const create = () => {
    const following = createFollowingRuntime({
      accountFollows: [
        createConfirmedAccountFollowMembership({
          platform: "twitch",
          settings,
          readAccountState: async () => state,
          source: { read: async () => outcome },
        }),
      ],
      cache: {
        clear: async () => undefined,
        get: async () => ({ kind: "miss" }),
        put: async () => undefined,
      },
      guestFollows: {
        list: async () => [],
        remove: async () => undefined,
        upsert: async () => follow,
      },
      liveNotifications: {
        read: async () => preferences,
        write: async () => preferences,
      },
      installation: async () => ({ kind: "none" }),
      network: async () => "online",
      relayBaseUrl: "http://relay.test",
    });
    return createNativeNotificationRuntime({
      activity: { record: async () => undefined },
      background: {
        configure: async (snapshot) => {
          snapshots.push(snapshot);
          return {
            schemaVersion: 1,
            scheduled:
              snapshot.policy.historyEnabled && snapshot.channels.length > 0,
            intervalMinutes: 15,
            channelCount: snapshot.channels.length,
            lastCheckedAtMs: null,
            failure: null,
          };
        },
        status: async () => ({
          schemaVersion: 1,
          scheduled: false,
          intervalMinutes: 15,
          channelCount: 0,
          lastCheckedAtMs: null,
          failure: null,
        }),
        pending: async () => [],
        acknowledge: async () => undefined,
      },
      channels: { ensure: async () => undefined },
      follows: following,
      postingPolicy: { apply: async () => undefined },
      presenter: { present: async () => undefined },
      receipts: { initial: async () => null, subscribe: () => () => undefined },
    });
  };
  return {
    create,
    snapshots,
    fail: () => {
      outcome = { kind: "unavailable", reason: "provider-failed" };
    },
    empty: () => {
      outcome = { kind: "available", follows: [] };
    },
    signOut: () => {
      state = { kind: "signed-out" };
    },
    setPreferences: (value: LiveNotificationPreferences) => {
      preferences = value;
    },
  };
}

describe("account follows background configuration", () => {
  it("keeps the saved account-only projection after an offline reopen", async () => {
    const test = setup();
    await test.create().sync();
    test.fail();
    const result = await test.create().sync();
    expect(result.status?.scheduled).toBe(true);
    expect(
      test.snapshots.map((snapshot) =>
        snapshot.channels.map((channel) => channel.channelId),
      ),
    ).toEqual([["123"], ["123"]]);
  });

  it.each(["empty", "signOut"] as const)(
    "removes confirmed account membership on %s",
    async (change) => {
      const test = setup();
      await test.create().sync();
      test[change]();
      expect((await test.create().sync()).status?.scheduled).toBe(false);
      expect(test.snapshots[1]?.channels).toEqual([]);
    },
  );

  it.each([
    { liveAlerts: false },
    { twitch: false },
    {
      favoriteChannelsOnly: true,
      perChannelNotifications: { "twitch:123": false },
    },
  ])(
    "applies changed notification policy during an account provider failure (%j)",
    async (policy) => {
      const test = setup();
      await test.create().sync();
      test.fail();
      test.setPreferences({
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        ...policy,
      });
      expect((await test.create().sync()).status?.scheduled).toBe(false);
      expect(test.snapshots[1]?.channels).toEqual([]);
    },
  );
});
