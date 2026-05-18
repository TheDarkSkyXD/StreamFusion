/**
 * useChatRoomState
 *
 * Reads the current chat-room state for a (platform, channelId) pair from
 * {@link useRoomStateStore}. When no entry exists the hook returns
 * {@link DEFAULT_ROOM_STATE}, so callers never have to null-check.
 *
 * TODO(U14.1): Today the value is optimistic-only — see room-state-store.ts.
 * Subscribe to twitch-chat ROOMSTATE events so external mod changes flow
 * back into the strip without re-mounting the channel.
 */

import {
  DEFAULT_ROOM_STATE,
  type RoomState,
  roomStateKey,
  useRoomStateStore,
} from "@/store/room-state-store";

export function useChatRoomState(
  platform: "twitch" | "kick",
  channelId: string | null,
): RoomState {
  return useRoomStateStore((state) => {
    if (!channelId) return DEFAULT_ROOM_STATE;
    return state.entries[roomStateKey(platform, channelId)] ?? DEFAULT_ROOM_STATE;
  });
}
