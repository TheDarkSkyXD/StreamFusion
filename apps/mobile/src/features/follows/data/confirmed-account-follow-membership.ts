import type { Platform } from "@streamfusion/core/platform";
import {
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import type {
  AccountFollowMembershipOutcome,
  AccountFollowMembershipSource,
  AccountMembershipState,
} from "../capabilities/account-follow-membership";

export function createConfirmedAccountFollowMembership(input: {
  readonly platform: Platform;
  readonly settings: ProductSettingsStore;
  readonly source: AccountFollowMembershipSource;
  readonly readAccountState: () => Promise<AccountMembershipState>;
  readonly now?: () => number;
}): AccountFollowMembershipSource {
  const key = `follows.confirmed-account.${input.platform}.v1`;
  const now = input.now ?? Date.now;
  let pending: Promise<unknown> = Promise.resolve();
  const unavailable: AccountFollowMembershipOutcome = {
    kind: "unavailable",
    reason: "account-membership-unavailable",
  };
  const clear = async (): Promise<AccountFollowMembershipOutcome> => {
    await input.settings.write(key, "null", now());
    return { kind: "available", follows: [] };
  };
  async function read(): Promise<AccountFollowMembershipOutcome> {
    const state = await input.readAccountState();
    if (state.kind === "signed-out") return clear();
    let saved = parseSnapshot(await input.settings.read(key), input.platform);
    if (state.kind === "unavailable")
      return saved === null
        ? unavailable
        : { kind: "available", follows: saved.follows };
    if (saved !== null && saved.accountId !== state.accountId) {
      await input.settings.write(key, "null", now());
      saved = null;
    }
    let outcome: AccountFollowMembershipOutcome;
    try {
      outcome = await input.source.read();
    } catch {
      outcome = unavailable;
    }
    const current = await input.readAccountState();
    if (current.kind === "signed-out") return clear();
    if (current.kind === "unavailable")
      return saved === null
        ? unavailable
        : { kind: "available", follows: saved.follows };
    if (current.accountId !== state.accountId) {
      await input.settings.write(key, "null", now());
      return { kind: "unavailable", reason: "account-membership-changed" };
    }
    const previous = saved?.accountId === state.accountId ? saved.follows : [];
    if (outcome.kind === "unavailable")
      return saved?.accountId === state.accountId
        ? { kind: "available", follows: previous }
        : outcome;
    const follows =
      outcome.kind === "partial"
        ? [
            ...new Map(
              [...previous, ...outcome.follows].map((follow) => [
                follow.channelId,
                follow,
              ]),
            ).values(),
          ]
        : outcome.follows;
    await input.settings.write(
      key,
      JSON.stringify({ schemaVersion: 1, accountId: state.accountId, follows }),
      now(),
    );
    return { kind: "available", follows };
  }
  return {
    read() {
      const reading = pending.then(read);
      pending = reading.catch(() => undefined);
      return reading;
    },
  };
}

function parseSnapshot(
  serialized: string | null,
  platform: Platform,
): {
  readonly accountId: string;
  readonly follows: readonly GuestFollow[];
} | null {
  if (serialized === null) return null;
  const value: unknown = JSON.parse(serialized);
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("accountId" in value) ||
    typeof value.accountId !== "string" ||
    value.accountId.trim() === "" ||
    !("follows" in value) ||
    !Array.isArray(value.follows)
  )
    throw new Error("Saved account follows are invalid.");
  const follows: GuestFollow[] = [];
  for (const row of value.follows) {
    const follow = parseGuestFollowWrite(row);
    if (follow === null || follow.platform !== platform)
      throw new Error("Saved account follows are invalid.");
    follows.push(follow);
  }
  return { accountId: value.accountId, follows };
}
