import type { AccountFollowReadResult } from "../capabilities/follows.ts";

export type FollowSourceFor<TPlatform extends string> = "guest" | TPlatform;

export type ActiveFollowCollection<TPlatform extends string> =
  | { readonly kind: "source"; readonly source: FollowSourceFor<TPlatform> }
  | { readonly kind: "unavailable" };

export function selectActiveFollowCollection<
  TPlatform extends string,
>(options: {
  readonly platform: TPlatform;
  readonly authenticated: boolean;
  readonly accountCollectionAvailable?: boolean;
}): ActiveFollowCollection<TPlatform> {
  if (!options.authenticated) return { kind: "source", source: "guest" };
  if (options.accountCollectionAvailable === false)
    return { kind: "unavailable" };
  return { kind: "source", source: options.platform };
}

export type FollowMutation<TPlatform extends string> = {
  readonly target: "guest" | "account";
  readonly action: "follow" | "unfollow";
  readonly platform: TPlatform;
};

export function resolveFollowMutation<TPlatform extends string>(options: {
  readonly platform: TPlatform;
  readonly currentSource: FollowSourceFor<TPlatform> | null;
  readonly accountAuthenticated: boolean;
}): FollowMutation<TPlatform> {
  if (options.currentSource === null) {
    return {
      target: options.accountAuthenticated ? "account" : "guest",
      action: "follow",
      platform: options.platform,
    };
  }
  return {
    target: options.currentSource === "guest" ? "guest" : "account",
    action: "unfollow",
    platform: options.platform,
  };
}

export type AccountFollowSyncPlan<TFollow> =
  | {
      readonly kind: "apply";
      readonly follows: readonly TFollow[];
      readonly pruneAbsent: boolean;
    }
  | {
      readonly kind: "preserve";
      readonly reason: string;
    };

export function planAccountFollowSync<TFollow>(
  result: AccountFollowReadResult<TFollow>,
): AccountFollowSyncPlan<TFollow> {
  return result.kind === "available"
    ? {
        kind: "apply",
        follows: result.follows,
        pruneAbsent: result.authoritative,
      }
    : { kind: "preserve", reason: result.reason };
}
