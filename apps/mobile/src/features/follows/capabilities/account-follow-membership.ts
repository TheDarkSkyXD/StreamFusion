import type { Stream } from "@streamfusion/core/content";
import type { GuestFollow } from "@streamfusion/core/follows";

/**
 * Signed-in account follow reads for Activity membership / go-live reconcile.
 * Missing client IDs or unsupported platform APIs must degrade to unavailable
 * without breaking Guest Follows.
 */
export type AccountFollowMembershipOutcome =
  | {
      readonly kind: "available" | "partial";
      readonly follows: readonly GuestFollow[];
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
    };

export interface AccountFollowMembershipSource {
  read(): Promise<AccountFollowMembershipOutcome>;
}

export type AccountMembershipState =
  | { readonly kind: "account"; readonly accountId: string }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unavailable" };

export interface AccountLiveStreamsSource {
  read(): Promise<readonly Stream[]>;
}
