/**
 * Twitch lead moderators wear `lead_moderator` instead of `moderator`.
 * @see https://discuss.dev.twitch.com/t/lead-moderator-role-and-chat-badge-introduced/64488
 */

export {
  TWITCH_MODERATOR_BADGE_SET_IDS,
  badgesIncludeTwitchModerator,
  isTwitchModeratorBadge,
} from "@streamfusion/core/chat";
