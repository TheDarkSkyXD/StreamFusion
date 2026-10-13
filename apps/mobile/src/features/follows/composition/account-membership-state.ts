import type {
  TwitchCredentialSnapshot,
  KickCredentialSnapshot,
} from "@streamfusion/core/auth";
import type { AccountMembershipState } from "../capabilities/account-follow-membership";

export async function readAccountMembershipState(
  readers: readonly (() => Promise<
    TwitchCredentialSnapshot | KickCredentialSnapshot
  >)[],
): Promise<AccountMembershipState> {
  try {
    const snapshots = await Promise.all(readers.map((read) => read()));
    for (const snapshot of snapshots) {
      if (snapshot.kind === "ready")
        return { kind: "account", accountId: snapshot.credential.account.id };
    }
    for (const snapshot of snapshots) {
      if (
        (snapshot.kind === "refresh-in-flight" ||
          snapshot.kind === "auth-lost") &&
        snapshot.account !== null
      ) {
        return { kind: "account", accountId: snapshot.account.id };
      }
    }
    return snapshots.every((snapshot) => snapshot.kind === "disconnected")
      ? { kind: "signed-out" }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
