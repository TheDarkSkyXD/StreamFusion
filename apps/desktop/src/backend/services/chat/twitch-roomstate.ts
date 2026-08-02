/**
 * Pure translation from tmi.js's `roomstate` event tags to a RoomState patch.
 *
 * Extracted from twitch-chat.ts so it can be unit-tested without spinning up
 * the tmi.js client. Mirrors the `twitch-irc-parser.ts` testability pattern.
 *
 * Tag semantics (tmi.js `RoomState` type):
 *   "followers-only": string | boolean — "-1" or false = off; "0" or true =
 *      on with no minimum (0 min); otherwise the value is minutes-of-account-age.
 *   "slow":           string | boolean — "0" or false = off; otherwise seconds.
 *   "r9k":            boolean → uniqueChat
 *   "emote-only":     boolean → emoteOnly
 *   "subs-only":      boolean → subscribersOnly
 *   "room-id":        string  — broadcaster user-id; surfaced separately.
 */

import type { RoomStatePatchEvent } from "../../../shared/chat-types";

/** Minimal tmi.js RoomState shape we depend on. Keeps the unit test free of tmi.js types. */
export interface TmiRoomStateTags {
  "followers-only"?: string | boolean;
  slow?: string | boolean;
  r9k?: boolean;
  "emote-only"?: boolean;
  "subs-only"?: boolean;
  "room-id"?: string;
}

/**
 * Translate tmi.js roomstate tags to a partial RoomState patch.
 * Returns an object with only the keys the tags actually set; absent tags
 * produce no key (which the merge seam interprets as "no change").
 */
export function roomStateTagsToPatch(tags: TmiRoomStateTags): RoomStatePatchEvent["patch"] {
  const patch: RoomStatePatchEvent["patch"] = {};

  if ("followers-only" in tags) {
    patch.followersOnly = parseFollowersOnly(tags["followers-only"]);
  }
  if ("slow" in tags) {
    patch.slowMode = parseSlow(tags.slow);
  }
  if ("r9k" in tags) {
    patch.uniqueChat = tags.r9k === true;
  }
  if ("emote-only" in tags) {
    patch.emoteOnly = tags["emote-only"] === true;
  }
  if ("subs-only" in tags) {
    patch.subscribersOnly = tags["subs-only"] === true;
  }
  return patch;
}

function parseFollowersOnly(value: string | boolean | undefined): number | null {
  if (value === undefined) return null;
  if (value === false) return null;
  if (value === true) return 0;
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return null; // "-1" = off
    return n;
  }
  return null;
}

function parseSlow(value: string | boolean | undefined): number | null {
  if (value === undefined) return null;
  if (value === false) return null;
  if (value === true) return null; // tmi.js never sends bare-true for slow; defensive.
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }
  return null;
}
