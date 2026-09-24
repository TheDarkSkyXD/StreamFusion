/**
 * Twitch lead moderators wear the `lead_moderator` badge set instead of
 * `moderator`. Treat either as moderator authority for UI gating and highlights.
 * @see https://discuss.dev.twitch.com/t/lead-moderator-role-and-chat-badge-introduced/64488
 */

export const TWITCH_MODERATOR_BADGE_SET_IDS = [
  "moderator",
  "lead_moderator",
] as const;

export type TwitchModeratorBadgeSetId =
  (typeof TWITCH_MODERATOR_BADGE_SET_IDS)[number];

export function isTwitchModeratorBadge(setId: string): boolean {
  const normalized = setId.toLowerCase();
  return normalized === "moderator" || normalized === "lead_moderator";
}

export function badgesIncludeTwitchModerator(
  badges: readonly { readonly setId: string }[],
): boolean {
  return badges.some((badge) => isTwitchModeratorBadge(badge.setId));
}
