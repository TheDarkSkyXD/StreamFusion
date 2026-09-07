/**
 * Slot crash retry policy. Pure function with no side effects so it can be
 * exhaustively unit-tested without spinning up real Chromium.
 *
 * Slice 06 of the renderer-OOM PRD (#51, issue #57). Behavior pinned in the
 * PRD: first crash within a 5-min rolling window → silent rebuild + reload.
 * Second crash within the same window → show a retry affordance overlay so
 * the user can decide.
 */

/** Rolling window the policy looks back over (5 minutes). */
export const SLOT_RETRY_WINDOW_MS = 5 * 60 * 1000;

export type SlotRetryOutcome = "silent-retry" | "affordance";

/**
 * Decide whether a slot crash should auto-retry silently or surface a retry
 * affordance to the user.
 *
 * The caller is expected to push the current crash's timestamp into
 * `crashTimestamps` BEFORE invoking this function — the count of crashes in
 * the rolling window therefore INCLUDES the current one. So:
 *   - 1 crash in window → "silent-retry" (the only one, rebuild silently)
 *   - 2+ crashes in window → "affordance" (it's happening again, ask the user)
 *
 * Timestamps outside the rolling window are ignored, so a quiet hour drops
 * the crash count back to zero.
 */
export function decideSlotRetryOutcome(
  crashTimestamps: readonly number[],
  now: number
): SlotRetryOutcome {
  const cutoff = now - SLOT_RETRY_WINDOW_MS;
  let recent = 0;
  for (const ts of crashTimestamps) {
    if (ts >= cutoff) recent++;
  }
  return recent <= 1 ? "silent-retry" : "affordance";
}
