import { describe, expect, it } from "vitest";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import type {
  AccountFollowMembershipOutcome,
  AccountMembershipState,
} from "../capabilities/account-follow-membership";
import { createConfirmedAccountFollowMembership } from "../data/confirmed-account-follow-membership";
import { guestFollow } from "../domain/following-fixtures";

function settingsStore(): ProductSettingsStore {
  const rows = new Map<string, string>();
  return {
    read: async (key) => rows.get(key) ?? null,
    write: async (key, value) => {
      rows.set(key, value);
    },
  };
}

const alice = guestFollow({ channelId: "alice", channelLogin: "alice" });
const bob = guestFollow({ channelId: "bob", channelLogin: "bob" });
const unavailable = { kind: "unavailable", reason: "network" } as const;

describe("confirmed account membership", () => {
  it("retains account-only follows after provider failure across runtime reconstruction", async () => {
    const settings = settingsStore();
    let outcome: AccountFollowMembershipOutcome = {
      kind: "available",
      follows: [alice],
    };
    const create = () =>
      createConfirmedAccountFollowMembership({
        platform: "twitch",
        settings,
        source: { read: async () => outcome },
        readAccountState: async () => ({
          kind: "account",
          accountId: "user-a",
        }),
      });
    await create().read();
    outcome = unavailable;
    await expect(create().read()).resolves.toEqual({
      kind: "available",
      follows: [alice],
    });
  });

  it("merges incomplete membership and clears only a confirmed complete empty read", async () => {
    let outcome: AccountFollowMembershipOutcome = {
      kind: "available",
      follows: [alice],
    };
    const source = createConfirmedAccountFollowMembership({
      platform: "twitch",
      settings: settingsStore(),
      source: { read: async () => outcome },
      readAccountState: async () => ({ kind: "account", accountId: "user-a" }),
    });
    await source.read();
    outcome = { kind: "partial", follows: [bob] };
    await expect(source.read()).resolves.toEqual({
      kind: "available",
      follows: [alice, bob],
    });
    outcome = unavailable;
    await expect(source.read()).resolves.toEqual({
      kind: "available",
      follows: [alice, bob],
    });
    outcome = { kind: "available", follows: [] };
    await expect(source.read()).resolves.toEqual({
      kind: "available",
      follows: [],
    });
    outcome = unavailable;
    await expect(source.read()).resolves.toEqual({
      kind: "available",
      follows: [],
    });
  });

  it("preserves transitional credential state and clears confirmed signout", async () => {
    let state: AccountMembershipState = {
      kind: "account",
      accountId: "user-a",
    };
    const settings = settingsStore();
    const create = () =>
      createConfirmedAccountFollowMembership({
        platform: "twitch",
        settings,
        source: { read: async () => ({ kind: "available", follows: [alice] }) },
        readAccountState: async () => state,
      });
    await create().read();
    state = { kind: "unavailable" };
    await expect(create().read()).resolves.toEqual({
      kind: "available",
      follows: [alice],
    });
    state = { kind: "signed-out" };
    await expect(create().read()).resolves.toEqual({
      kind: "available",
      follows: [],
    });
    state = { kind: "unavailable" };
    await expect(create().read()).resolves.toEqual({
      kind: "unavailable",
      reason: "account-membership-unavailable",
    });
  });

  it("does not reuse one account's saved follows for another account", async () => {
    let state: AccountMembershipState = {
      kind: "account",
      accountId: "user-a",
    };
    let outcome: AccountFollowMembershipOutcome = {
      kind: "available",
      follows: [alice],
    };
    const source = createConfirmedAccountFollowMembership({
      platform: "twitch",
      settings: settingsStore(),
      source: { read: async () => outcome },
      readAccountState: async () => state,
    });
    await source.read();
    state = { kind: "account", accountId: "user-b" };
    outcome = unavailable;
    await expect(source.read()).resolves.toEqual(unavailable);
    state = { kind: "unavailable" };
    await expect(source.read()).resolves.toEqual({
      kind: "unavailable",
      reason: "account-membership-unavailable",
    });
  });

  it("does not restore another account's snapshot when credentials become unavailable during a read", async () => {
    let state: AccountMembershipState = {
      kind: "account",
      accountId: "user-a",
    };
    let fetchState = false;
    const source = createConfirmedAccountFollowMembership({
      platform: "twitch",
      settings: settingsStore(),
      source: {
        read: async () => {
          if (fetchState) state = { kind: "unavailable" };
          return { kind: "available", follows: [alice] };
        },
      },
      readAccountState: async () => state,
    });
    await source.read();
    state = { kind: "account", accountId: "user-b" };
    fetchState = true;
    await expect(source.read()).resolves.toEqual({
      kind: "unavailable",
      reason: "account-membership-unavailable",
    });
  });

  it("discards an in-flight membership response when the account changes", async () => {
    let state: AccountMembershipState = {
      kind: "account",
      accountId: "user-a",
    };
    let finish: (outcome: AccountFollowMembershipOutcome) => void = () =>
      undefined;
    const response = new Promise<AccountFollowMembershipOutcome>((resolve) => {
      finish = resolve;
    });
    const source = createConfirmedAccountFollowMembership({
      platform: "twitch",
      settings: settingsStore(),
      source: { read: () => response },
      readAccountState: async () => state,
    });
    const reading = source.read();
    await Promise.resolve();
    state = { kind: "account", accountId: "user-b" };
    finish({ kind: "available", follows: [alice] });
    await expect(reading).resolves.toEqual({
      kind: "unavailable",
      reason: "account-membership-changed",
    });
  });
});
