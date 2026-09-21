import {
  guestFollowKey,
  type GuestFollow,
} from "@streamfusion/core/follows";

/** Union Guest Follows with account follows; guest wins on key collisions. */
export function unionFollowMembership(
  guest: readonly GuestFollow[],
  account: readonly GuestFollow[],
): readonly GuestFollow[] {
  const byKey = new Map<string, GuestFollow>();
  for (const follow of account) byKey.set(guestFollowKey(follow), follow);
  for (const follow of guest) byKey.set(guestFollowKey(follow), follow);
  return [...byKey.values()];
}
