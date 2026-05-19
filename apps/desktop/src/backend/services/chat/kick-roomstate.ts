/**
 * Pure translation from the Kick Pusher `App\Events\ChatroomUpdatedEvent`
 * payload to a RoomState patch.
 *
 * Verified event payload shape against KickTalk's reference
 * (`reference/KickTalk-main/src/renderer/src/components/Chat/Input/InfoBar.jsx`
 * lines 12-22), which destructures:
 *   chatroomInfo.followers_mode.enabled / .min_duration
 *   chatroomInfo.subscribers_mode.enabled
 *   chatroomInfo.emotes_mode.enabled
 *   chatroomInfo.slow_mode.enabled / .message_interval
 *   chatroomInfo.account_age.enabled / .min_duration
 *
 * Units verified against InfoBar.jsx:
 *   followers_mode.min_duration → minutes (passed straight to convertSecondsToHumanReadable * 60)
 *   account_age.min_duration    → minutes (same handling)
 *   slow_mode.message_interval  → seconds (passed straight to convertSecondsToHumanReadable)
 */

import type { RoomStatePatchEvent } from "../../../shared/chat-types";

export interface KickChatroomUpdatedEventPayload {
  slow_mode?: { enabled: boolean; message_interval?: number | null };
  followers_mode?: { enabled: boolean; min_duration?: number | null };
  subscribers_mode?: { enabled: boolean };
  emotes_mode?: { enabled: boolean };
  account_age?: { enabled: boolean; min_duration?: number | null };
}

/**
 * Translate a Kick chatroom-update event payload to a partial RoomState patch.
 * Returns an object with only the keys for fields the payload sets.
 */
export function chatroomUpdatedEventToPatch(
  payload: KickChatroomUpdatedEventPayload,
): RoomStatePatchEvent["patch"] {
  const patch: RoomStatePatchEvent["patch"] = {};

  if (payload.slow_mode) {
    patch.slowMode = payload.slow_mode.enabled
      ? (typeof payload.slow_mode.message_interval === "number"
          ? payload.slow_mode.message_interval
          : null)
      : null;
  }
  if (payload.followers_mode) {
    patch.followersOnly = payload.followers_mode.enabled
      ? (typeof payload.followers_mode.min_duration === "number"
          ? payload.followers_mode.min_duration
          : null)
      : null;
  }
  if (payload.subscribers_mode) {
    patch.subscribersOnly = payload.subscribers_mode.enabled === true;
  }
  if (payload.emotes_mode) {
    patch.emoteOnly = payload.emotes_mode.enabled === true;
  }
  if (payload.account_age) {
    patch.accountAge = payload.account_age.enabled
      ? (typeof payload.account_age.min_duration === "number"
          ? payload.account_age.min_duration
          : null)
      : null;
  }

  return patch;
}
