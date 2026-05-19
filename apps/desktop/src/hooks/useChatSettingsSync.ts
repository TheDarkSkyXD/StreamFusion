/**
 * useChatSettingsSync — merge seam (U6)
 *
 * Single converge point for the three RoomState sources behind the chat-input
 * info banner: (1) initial fetch on mount, (2) WS `roomState` events emitted
 * by the platform chat services, (3) optimistic mod-strip writes already
 * landing in `useRoomStateStore`. All three write to the same key with
 * last-write-wins semantics.
 *
 * Race protection follows the dual-id-bridge learning
 * (`docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`):
 * a module-scoped in-flight Set discards stale completions after channel
 * switch, and a per-mount AbortController short-circuits before the store
 * write even when the rejected promise loses the unmount race
 * (StrictMode same-key remount).
 *
 * Reconnect re-fetch: a transition into the `connected` connection state
 * AFTER the initial connect re-seeds RoomState from the authoritative initial
 * fetch — closes the staleness window for events dropped during the
 * disconnect. The first `connected` does NOT re-fetch (the mount path already
 * handled it).
 */

import { useEffect, useRef } from "react";

import { getChatSettings } from "@/backend/api/platforms/twitch/twitch-helix-chat-settings";
import { withTwitchHelixRetry } from "@/backend/api/platforms/twitch/helix-retry";
import type { ChatSettingsPayload } from "@/backend/api/platforms/twitch/twitch-helix-moderation-mutations";
import { kickChatService } from "@/backend/services/chat/kick-chat";
import { twitchChatService } from "@/backend/services/chat/twitch-chat";
import type { KickChatroomSettings, UnifiedChannel } from "@/backend/api/unified/platform-types";
import type {
  ChatConnectionStatus,
  ChatPlatform,
  RoomStatePatchEvent,
} from "@/shared/chat-types";
import { roomStateKey, type RoomState, useRoomStateStore } from "@/store/room-state-store";

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/**
 * Per-key in-flight guard. Keyed by `${platform}:${channelKey}`. A pending
 * fetch enters the set; completion removes it. A cleanup-then-remount cycle
 * caused by React StrictMode (or rapid channel toggles) bypasses the dedup
 * via the per-mount AbortController, not this Set, so this Set is purely
 * about avoiding redundant network calls in normal lifecycle.
 */
const inFlight = new Set<string>();

/**
 * Dev-only provenance map. Records the last write source for each room-state
 * key so tests can assert that `'ws'` arrived after `'fetch'` etc. Production
 * code never reads this — the store entry is the same regardless of how it
 * got written.
 */
type Provenance = "fetch" | "ws" | "optimistic";
const __debugProvenance = new Map<string, Provenance>();

/** Test-only inspection helper. Not for production consumers. */
export function __getProvenance(key: string): Provenance | undefined {
  return __debugProvenance.get(key);
}

/** Test-only reset helper. */
export function __resetProvenance(): void {
  __debugProvenance.clear();
}

/** Test-only inspection helper for the in-flight set. */
export function __isInFlight(key: string): boolean {
  return inFlight.has(key);
}

/** Test-only reset helper for the in-flight set. */
export function __resetInFlight(): void {
  inFlight.clear();
}

// ---------------------------------------------------------------------------
// Pure translator — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Translate platform-native chat-settings payloads into a `RoomState` patch.
 *
 * **Critical**: each `*_mode` boolean flag MUST be read before its companion
 * duration field. Twitch's Helix response and Kick's v2 channel-resolve block
 * both leave `follower_mode_duration` / `slow_mode_wait_time` /
 * `min_duration` as the last-known value when the mode is turned off — using
 * the duration without first checking the enable flag would surface a stale
 * "Followers Only Mode [10m]" banner on a channel where followers-only is
 * actually off.
 */
export function chatSettingsToPatch(
  platform: "twitch",
  payload: ChatSettingsPayload,
): Partial<RoomState>;
export function chatSettingsToPatch(
  platform: "kick",
  payload: KickChatroomSettings,
): Partial<RoomState>;
export function chatSettingsToPatch(
  platform: ChatPlatform,
  payload: ChatSettingsPayload | KickChatroomSettings,
): Partial<RoomState> {
  if (platform === "twitch") {
    return twitchChatSettingsToPatch(payload as ChatSettingsPayload);
  }
  return kickChatroomSettingsToPatch(payload as KickChatroomSettings);
}

function twitchChatSettingsToPatch(payload: ChatSettingsPayload): Partial<RoomState> {
  const patch: Partial<RoomState> = {};

  // Slow mode — enable flag first, duration second. A stale leftover
  // `slow_mode_wait_time` must NOT be surfaced when `slow_mode` is false.
  if (payload.slow_mode !== undefined) {
    if (payload.slow_mode === true) {
      patch.slowMode =
        typeof payload.slow_mode_wait_time === "number" ? payload.slow_mode_wait_time : 0;
    } else {
      patch.slowMode = null;
    }
  }

  // Follower mode — same enable-first pattern; Twitch reports duration in
  // minutes, which matches RoomState's unit on the wire.
  if (payload.follower_mode !== undefined) {
    if (payload.follower_mode === true) {
      patch.followersOnly =
        typeof payload.follower_mode_duration === "number"
          ? payload.follower_mode_duration
          : 0;
    } else {
      patch.followersOnly = null;
    }
  }

  if (payload.subscriber_mode !== undefined) {
    patch.subscribersOnly = payload.subscriber_mode;
  }
  if (payload.emote_mode !== undefined) {
    patch.emoteOnly = payload.emote_mode;
  }
  if (payload.unique_chat_mode !== undefined) {
    patch.uniqueChat = payload.unique_chat_mode;
  }

  return patch;
}

function kickChatroomSettingsToPatch(settings: KickChatroomSettings): Partial<RoomState> {
  const patch: Partial<RoomState> = {};

  if (settings.slowMode) {
    patch.slowMode = settings.slowMode.enabled ? settings.slowMode.interval ?? 0 : null;
  }
  if (settings.followersMode) {
    patch.followersOnly = settings.followersMode.enabled
      ? settings.followersMode.minDuration ?? 0
      : null;
  }
  if (settings.subscribersMode) {
    patch.subscribersOnly = settings.subscribersMode.enabled;
  }
  if (settings.emoteOnlyMode) {
    patch.emoteOnly = settings.emoteOnlyMode.enabled;
  }
  if (settings.accountAge) {
    patch.accountAge = settings.accountAge.enabled
      ? settings.accountAge.minDuration ?? 0
      : null;
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseChatSettingsSyncArgs {
  platform: ChatPlatform;
  /** Channel slug (Kick) or login sans `#` (Twitch). Match key for WS events. */
  channel: string;
  /** Numeric id — broadcaster_id for Twitch, chatroom_id for Kick. Store key. */
  channelId: string | null | undefined;
}

/**
 * Owns the chat-settings sync lifecycle for one mounted (TwitchChat|KickChat)
 * component instance.
 */
export function useChatSettingsSync({
  platform,
  channel,
  channelId,
}: UseChatSettingsSyncArgs): void {
  // Track whether the service has reached `connected` at least once for this
  // mount. A `connected` transition while `hasConnectedOnce` is false means
  // "first connect" (mount-path fetch already covers it). A `connected`
  // transition while it's true means "reconnect" — fire the re-fetch.
  const hasConnectedOnceRef = useRef(false);

  useEffect(() => {
    if (!channelId) return;

    const key = roomStateKey(platform, channelId);
    const controller = new AbortController();
    const updateRoomState = useRoomStateStore.getState().updateRoomState;

    // -- Fetch helper (used by mount and reconnect paths) ---------------
    const runFetch = async (): Promise<void> => {
      if (inFlight.has(key)) return;
      inFlight.add(key);

      try {
        const patch = await fetchPatchFor(platform, channel, channelId, controller.signal);
        if (controller.signal.aborted) return;
        // If our key was cleared during the in-flight window (channel
        // switched away then back), don't write — the new mount owns it.
        // We re-check membership instead of relying solely on abort because
        // the same-key remount path uses a fresh controller.
        if (patch) {
          updateRoomState(platform, channelId, patch);
          __debugProvenance.set(key, "fetch");
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // Failure is non-fatal — the banner stays hidden (R19). Surface via
        // warn so it shows up next to other chat-join failure logs without
        // tripping error boundaries.
        console.warn("[useChatSettingsSync] initial fetch failed:", err);
      } finally {
        inFlight.delete(key);
      }
    };

    // -- WS event subscription -----------------------------------------
    const service = platform === "twitch" ? twitchChatService : kickChatService;

    const handleRoomState = (event: RoomStatePatchEvent): void => {
      if (event.platform !== platform) return;
      if (event.channel !== channel) return;
      updateRoomState(platform, channelId, event.patch);
      __debugProvenance.set(key, "ws");
    };

    const handleConnectionStateChange = (status: ChatConnectionStatus): void => {
      if (status.platform !== platform) return;
      if (status.state !== "connected") return;
      if (!hasConnectedOnceRef.current) {
        // First connect — the mount-path fetch already covers initial state.
        hasConnectedOnceRef.current = true;
        return;
      }
      // Reconnect — re-seed RoomState from the authoritative fetch. Clear
      // any stale in-flight key first so the new fetch isn't suppressed by
      // a pre-disconnect call that the AbortController already cut short.
      inFlight.delete(key);
      void runFetch();
    };

    service.on("roomState", handleRoomState);
    service.on("connectionStateChange", handleConnectionStateChange);

    // Kick off the initial fetch.
    void runFetch();

    return () => {
      controller.abort();
      service.off("roomState", handleRoomState);
      service.off("connectionStateChange", handleConnectionStateChange);
      // Aborted fetches still need their key cleared so a same-key remount
      // can immediately re-fetch. The `finally` in runFetch handles this
      // when the rejected promise resolves, but eagerly clearing here keeps
      // the StrictMode mount-A → unmount → mount-A → fetch path responsive.
      inFlight.delete(key);
    };
  }, [platform, channel, channelId]);
}

// ---------------------------------------------------------------------------
// Per-platform fetch
// ---------------------------------------------------------------------------

async function fetchPatchFor(
  platform: ChatPlatform,
  channel: string,
  channelId: string,
  signal: AbortSignal,
): Promise<Partial<RoomState> | null> {
  if (platform === "twitch") {
    // Helix /chat/settings requires a Bearer token. Fetch a guaranteed-fresh
    // one (auto-refreshes if expired) and let the retry wrapper handle the
    // race where the token expires between our fetch and Twitch's check.
    const accessToken = await window.electronAPI.auth.getValidTwitchToken();
    if (!accessToken) {
      return null;
    }
    const result = await withTwitchHelixRetry(
      { accessToken, broadcasterId: channelId, signal },
      getChatSettings,
    );
    if (!result.ok) {
      // Non-2xx is a soft-failure for the banner. Treat exactly the same as
      // a network error — the banner stays hidden.
      return null;
    }
    return chatSettingsToPatch("twitch", result.payload);
  }

  // Kick — read the cached UnifiedChannel and pull `chatroomSettings`. The
  // v2 channel-resolve already fired during channel mount; this IPC call is
  // a cache hit in the common case.
  try {
    const response = await window.electronAPI.channels.getByUsername({
      platform: "kick",
      username: channel,
    });
    if (signal.aborted) return null;
    if (response.error) return null;
    const ch = response.data as UnifiedChannel | undefined;
    if (!ch?.chatroomSettings) return null;
    return chatSettingsToPatch("kick", ch.chatroomSettings);
  } catch (err) {
    if (signal.aborted) return null;
    throw err;
  }
}
