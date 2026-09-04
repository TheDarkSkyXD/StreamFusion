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

import { useEffect } from "react";
import type { KickChatroomSettings, UnifiedChannel } from "@shared/platform-types";
import {
  getLoadedChatRoomStateEventSource,
  loadChatRoomStateEventSource,
  type ChatRoomStateEventSource,
} from "@backend/services/chat/chat-service-loader";
import { logger } from "@/renderer/logging/logger";
import type { ChatConnectionStatus, RoomStatePatchEvent } from "@shared/chat-types";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import type { TwitchChatSettings } from "@shared/twitch-api-types";
import {
  DEFAULT_ROOM_STATE,
  type RoomState,
  roomStateKey,
  useRoomStateStore,
} from "@/store/room-state-store";

const ROOM_STATE_FIELDS = [
  "slowMode",
  "followersOnly",
  "subscribersOnly",
  "emoteOnly",
  "uniqueChat",
  "shieldMode",
  "accountAge",
] as const satisfies readonly (keyof RoomState)[];

// ---------------------------------------------------------------------------
// Module-scoped state
//
// `inFlight` and `__debugProvenance` are exported with the `@internal` JSDoc
// tag for the test-helpers sibling (`useChatSettingsSync.test-helpers.ts`)
// only. Production consumers MUST NOT import these names — call sites of the
// hook should treat them as private implementation detail. The
// underscore-prefixed test inspectors that used to live here have moved to
// the test-helpers file so they no longer ship as public exports.
// ---------------------------------------------------------------------------

/**
 * Per-key in-flight guard. Keyed by `${platform}:${channelKey}`. A pending
 * fetch enters the set; completion removes it. A cleanup-then-remount cycle
 * caused by React StrictMode (or rapid channel toggles) bypasses the dedup
 * via the per-mount AbortController, not this Set, so this Set is purely
 * about avoiding redundant network calls in normal lifecycle.
 *
 * @internal exported for `useChatSettingsSync.test-helpers.ts` only.
 */
export const inFlight = new Set<string>();

/** @internal */
export type Provenance = "fetch" | "ws" | "optimistic";

/**
 * Dev-only provenance map. Records the last write source for each room-state
 * key so tests can assert that `'ws'` arrived after `'fetch'` etc. Production
 * code never reads this — the store entry is the same regardless of how it
 * got written.
 *
 * @internal exported for `useChatSettingsSync.test-helpers.ts` only.
 */
export const __debugProvenance = new Map<string, Provenance>();

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
  payload: TwitchChatSettings
): Partial<RoomState>;
export function chatSettingsToPatch(
  platform: "kick",
  payload: KickChatroomSettings
): Partial<RoomState>;
export function chatSettingsToPatch(
  platform: ChatPlatform,
  payload: TwitchChatSettings | KickChatroomSettings
): Partial<RoomState> {
  if (platform === "twitch") {
    return twitchChatSettingsToPatch(payload as TwitchChatSettings);
  }
  return kickChatroomSettingsToPatch(payload as KickChatroomSettings);
}

function twitchChatSettingsToPatch(payload: TwitchChatSettings): Partial<RoomState> {
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
        typeof payload.follower_mode_duration === "number" ? payload.follower_mode_duration : 0;
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
    patch.slowMode = settings.slowMode.enabled ? (settings.slowMode.interval ?? 0) : null;
  }
  if (settings.followersMode) {
    patch.followersOnly = settings.followersMode.enabled
      ? (settings.followersMode.minDuration ?? 0)
      : null;
  }
  if (settings.subscribersMode) {
    patch.subscribersOnly = settings.subscribersMode.enabled;
  }
  if (settings.emoteOnlyMode) {
    patch.emoteOnly = settings.emoteOnlyMode.enabled;
  }
  if (settings.accountAge) {
    patch.accountAge = settings.accountAge.enabled ? (settings.accountAge.minDuration ?? 0) : null;
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
  useEffect(() => {
    if (!channelId) return;

    const key = roomStateKey(platform, channelId);
    const mountController = new AbortController();
    // R4 — Track the currently-active fetch controller so reconnect-driven
    // re-fetches can abort the prior in-flight fetch before starting a new
    // one. Without this, a reconnect storm produces N concurrent fetches
    // racing for last-writer; the slowest-resolving one wins regardless of
    // freshness. Per-mount only — cross-mount dedup is still handled by
    // the module-scoped `inFlight` Set.
    let fetchController: AbortController | null = null;
    // R3 — When a WS `roomState` event lands during an in-flight fetch, the
    // Preserve WS writes without discarding untouched fields from the
    // authoritative snapshot.
    let wsFieldsDuringFetch: Set<keyof RoomState> | null = null;
    let detachServiceListeners: (() => void) | undefined;

    const updateRoomState = useRoomStateStore.getState().updateRoomState;
    const resetRoomState = useRoomStateStore.getState().resetRoomState;

    const clearUnavailableSnapshot = (wsFields: Set<keyof RoomState>): void => {
      if (wsFields.size === 0) {
        resetRoomState(platform, channelId);
        return;
      }

      const resetPatch: Partial<RoomState> = { ...DEFAULT_ROOM_STATE };
      for (const field of wsFields) {
        delete resetPatch[field];
      }
      updateRoomState(platform, channelId, resetPatch);
    };

    // -- Fetch helper (used by mount and reconnect paths) ---------------
    const runFetch = async (): Promise<void> => {
      if (inFlight.has(key)) return;
      inFlight.add(key);
      const localController = new AbortController();
      fetchController = localController;
      const localWsFields = new Set<keyof RoomState>();
      wsFieldsDuringFetch = localWsFields;

      try {
        const patch = await fetchPatchFor(platform, channel, channelId, localController.signal);
        if (localController.signal.aborted) return;
        if (mountController.signal.aborted) return;
        if (patch) {
          const reconciledPatch = { ...patch };
          for (const field of localWsFields) {
            delete reconciledPatch[field];
          }
          if (Object.keys(reconciledPatch).length > 0) {
            updateRoomState(platform, channelId, reconciledPatch);
            __debugProvenance.set(key, "fetch");
          }
        } else {
          clearUnavailableSnapshot(localWsFields);
        }
      } catch (err) {
        if (localController.signal.aborted) return;
        if (mountController.signal.aborted) return;
        // Failure is non-fatal — the banner stays hidden (R19). Surface via
        // warn so it shows up next to other chat-join failure logs without
        // tripping error boundaries.
        logger.warn("Hook:ChatSettings", "initial fetch failed", {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
        clearUnavailableSnapshot(localWsFields);
      } finally {
        if (fetchController === localController) {
          fetchController = null;
          wsFieldsDuringFetch = null;
        }
        inFlight.delete(key);
      }
    };

    // -- WS event subscription -----------------------------------------
    const handleRoomState = (event: RoomStatePatchEvent): void => {
      if (event.platform !== platform) return;
      if (event.channel.toLowerCase() !== channel.toLowerCase()) return;
      updateRoomState(platform, channelId, event.patch);
      __debugProvenance.set(key, "ws");
      if (fetchController && wsFieldsDuringFetch) {
        for (const field of ROOM_STATE_FIELDS) {
          if (field in event.patch) wsFieldsDuringFetch.add(field);
        }
      }
    };

    // Kick off the initial fetch.
    void runFetch();

    const attachServiceListeners = (service: ChatRoomStateEventSource): void => {
      if (mountController.signal.aborted) return;

      // R2 — Seed from the service's current state so a hook mounting after
      // connect still treats the next connection as a reconnect.
      let hasConnectedOnce = service.getConnectionStatus?.()?.state === "connected";
      const handleConnectionStateChange = (status: ChatConnectionStatus): void => {
        if (status.platform !== platform || status.state !== "connected") return;
        if (!hasConnectedOnce) {
          hasConnectedOnce = true;
          return;
        }
        if (fetchController) fetchController.abort();
        inFlight.delete(key);
        void runFetch();
      };

      service.on("roomState", handleRoomState);
      service.on("connectionStateChange", handleConnectionStateChange);
      detachServiceListeners = () => {
        service.off("roomState", handleRoomState);
        service.off("connectionStateChange", handleConnectionStateChange);
      };
    };

    const loadedService = getLoadedChatRoomStateEventSource(platform);
    if (loadedService) {
      attachServiceListeners(loadedService);
    } else {
      void loadChatRoomStateEventSource(platform)
        .then(attachServiceListeners)
        .catch((error: unknown) => {
          if (mountController.signal.aborted) return;
          logger.warn("Hook:ChatSettings", "chat event source failed to load", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    return () => {
      mountController.abort();
      if (fetchController) fetchController.abort();
      detachServiceListeners?.();
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
  signal: AbortSignal
): Promise<Partial<RoomState> | null> {
  if (platform === "twitch") {
    // Helix /chat/settings requires a Bearer token AND the Client-Id of the
    // app that minted it — Twitch returns 401 if they don't match. The
    // The renderer delegates this call to main so neither credential needs
    // renderer-side build configuration.
    const result = await window.electronAPI.twitch.execute({
      operation: "get-chat-settings",
      broadcasterId: channelId,
    });
    if (signal.aborted) return null;
    if (!result.ok) {
      // Non-2xx is a soft-failure for the banner. Treat exactly the same as
      // a network error — the banner stays hidden.
      return null;
    }
    return chatSettingsToPatch("twitch", result.data as TwitchChatSettings);
  }

  // Kick: bypass channel metadata caching so the chat-mode snapshot is
  // current whenever chat mounts or reconnects.
  try {
    const response = await window.electronAPI.channels.getByUsername({
      platform: "kick",
      username: channel,
      freshChatroomSettings: true,
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
