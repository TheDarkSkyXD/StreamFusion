export type PendingFollowAction = "follow" | "unfollow";
export type PendingFollowWriteStatus = "pending" | "retrying" | "auth-paused" | "failed";

/**
 * Tombstone-equivalent row tracking a push-sync write that hasn't yet been
 * confirmed by the platform. Reconciliation (background sync) consults this
 * to distinguish "user intended unfollow, push failed" (don't re-adopt the
 * platform row) from "user never followed this on platform" (adopt as
 * account-source per existing import behavior).
 *
 * The `slug` column is essential for Kick rows where `channelId` may carry
 * a stale `user_id` from the dual-id problem; `removePendingFollowWrite`
 * matches via the `channelsMatch` primitive (platform AND (id OR slug)).
 */
export interface PendingFollowWrite {
  id: number;
  platform: string;
  channelId: string;
  slug: string;
  action: PendingFollowAction;
  status: PendingFollowWriteStatus;
  createdAt: string;
  attemptedAt: string;
  nextAttemptAt: string;
  expiresAt: string;
  attemptCount: number;
  lastError: string | null;
}
