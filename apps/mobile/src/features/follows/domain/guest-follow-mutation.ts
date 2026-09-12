import {
  findGuestFollow,
  resolveFollowMutation,
  selectActiveFollowCollection,
  type GuestFollow,
} from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";

export function guestFollowMutation(input: {
  readonly authenticated: boolean;
  readonly membership: readonly GuestFollow[];
  readonly platform: Platform;
  readonly channelId?: string;
  readonly channelLogin?: string;
}):
  | { readonly kind: "follow" }
  | { readonly kind: "unfollow"; readonly follow: GuestFollow }
  | { readonly kind: "rejected"; readonly reason: "guest-only-scope" } {
  const collection = selectActiveFollowCollection({
    authenticated: input.authenticated,
    platform: input.platform,
  });
  if (collection.kind !== "source" || collection.source !== "guest") {
    return { kind: "rejected", reason: "guest-only-scope" };
  }
  const existing = findGuestFollow(input.membership, {
    platform: input.platform,
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    ...(input.channelLogin === undefined
      ? {}
      : { channelLogin: input.channelLogin }),
  });
  const mutation = resolveFollowMutation({
    accountAuthenticated: input.authenticated,
    currentSource: existing === undefined ? null : "guest",
    platform: input.platform,
  });
  if (mutation.target !== "guest") {
    return { kind: "rejected", reason: "guest-only-scope" };
  }
  if (mutation.action === "unfollow") {
    return existing === undefined
      ? { kind: "rejected", reason: "guest-only-scope" }
      : { kind: "unfollow", follow: existing };
  }
  return { kind: "follow" };
}
