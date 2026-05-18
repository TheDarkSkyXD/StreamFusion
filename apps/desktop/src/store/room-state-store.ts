/**
 * Per-channel chat-room-state store (U14, optimistic-only).
 *
 * Keyed by `${platform}:${channelId}`. Today this store is fed exclusively
 * from successful mutation calls inside the inline mod strip and related
 * mod surfaces — i.e. the value of e.g. `slowMode` flips locally only after
 * the operator confirms the dialog and the Helix / Kick call succeeds.
 *
 * TODO(U14.1): Subscribe to twitch-chat ROOMSTATE events to get
 * authoritative external updates. Today the state is optimistic-only —
 * if another moderator toggles slow mode from a different surface we won't
 * reflect that until the user reopens the channel.
 */

import { create } from "zustand";

export interface RoomState {
  /** Slow-mode message interval in seconds. `null` = off. */
  slowMode: number | null;
  /**
   * Followers-only minimum age. Twitch reports minutes; Kick reports
   * seconds — call-sites normalise to minutes before writing here so the
   * unit on the wire here is always minutes.
   */
  followersOnly: number | null;
  subscribersOnly: boolean;
  emoteOnly: boolean;
  /** Twitch only — Kick has no equivalent. */
  uniqueChat: boolean;
  /** Twitch only — Kick has no equivalent. */
  shieldMode: boolean;
}

export const DEFAULT_ROOM_STATE: RoomState = {
  slowMode: null,
  followersOnly: null,
  subscribersOnly: false,
  emoteOnly: false,
  uniqueChat: false,
  shieldMode: false,
};

interface RoomStateStore {
  entries: Record<string, RoomState>;
  updateRoomState: (
    platform: "twitch" | "kick",
    channelId: string,
    patch: Partial<RoomState>,
  ) => void;
  resetRoomState: (platform: "twitch" | "kick", channelId: string) => void;
}

function keyFor(platform: "twitch" | "kick", channelId: string): string {
  return `${platform}:${channelId}`;
}

export const useRoomStateStore = create<RoomStateStore>()((set) => ({
  entries: {},
  updateRoomState: (platform, channelId, patch) =>
    set((prev) => {
      const key = keyFor(platform, channelId);
      const current = prev.entries[key] ?? DEFAULT_ROOM_STATE;
      return {
        entries: { ...prev.entries, [key]: { ...current, ...patch } },
      };
    }),
  resetRoomState: (platform, channelId) =>
    set((prev) => {
      const key = keyFor(platform, channelId);
      if (!(key in prev.entries)) return prev;
      const next = { ...prev.entries };
      delete next[key];
      return { entries: next };
    }),
}));

export function roomStateKey(platform: "twitch" | "kick", channelId: string): string {
  return keyFor(platform, channelId);
}
