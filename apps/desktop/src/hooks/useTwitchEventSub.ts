/**
 * useTwitchEventSub
 *
 * Renderer-side consumer of the shared `TwitchEventSubClient`. Lazily
 * resolves the singleton via `getTwitchEventSubClient(accessToken, selfId)`
 * once both an access token and a channelId are available, then subscribes
 * for the given `(eventType, channelId)` pair. The listener is read through
 * a ref so callers don't have to memoize it.
 *
 * Returns the live `connectionState`, reactive via the client's
 * `onConnectionStateChange` observable.
 *
 * When `accessToken` is missing or `channelId` is null, the hook returns
 * `{ connectionState: "idle" }` and does NOT instantiate the client.
 */

import { useEffect, useRef, useState } from "react";

import {
  type TwitchEventSubClient,
  getTwitchEventSubClient,
} from "@/backend/api/platforms/twitch/twitch-eventsub-client";
import type {
  NotificationPayload,
  TwitchEventSubConnectionState,
  TwitchEventSubEventType,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";
import { useAuthStore } from "@/store/auth-store";

interface AuthSlice {
  accessToken: string | null;
  selfBroadcasterId: string | null;
}

/**
 * Read the access token + signed-in user id from the auth store. The auth
 * store does NOT currently surface the renderer-side access token directly
 * (tokens live in the main process; the renderer talks via IPC). For U8 we
 * pull the user id from `twitchUser.id` and rely on the (forthcoming)
 * preload bridge that surfaces a short-lived access token. Until that
 * bridge lands, callers that need EventSub will need to fetch the token
 * via `window.electronAPI.auth.getToken("twitch")` and pass it down — see
 * U20 wiring.
 *
 * For now we treat `accessToken` as null whenever it isn't surfaced, which
 * keeps the hook in the idle path and avoids spurious WS connections.
 */
function useAuthSlice(): AuthSlice {
  const twitchUser = useAuthStore((state) => state.twitchUser);
  // The auth store doesn't expose the access token directly today; downstream
  // call-sites (U20, U22) will supply one via a wrapper. We read it off the
  // store under a defensive cast to keep this hook decoupled from the exact
  // store shape.
  const store = useAuthStore.getState() as unknown as {
    twitchAccessToken?: string | null;
  };
  return {
    accessToken: store.twitchAccessToken ?? null,
    selfBroadcasterId: twitchUser?.id ?? null,
  };
}

export function useTwitchEventSub<E = unknown>(
  eventType: TwitchEventSubEventType,
  channelId: string | null,
  listener: (event: NotificationPayload<E>) => void,
): { connectionState: TwitchEventSubConnectionState } {
  const { accessToken, selfBroadcasterId } = useAuthSlice();
  const [connectionState, setConnectionState] =
    useState<TwitchEventSubConnectionState>("idle");

  // Hold the latest listener in a ref so we don't tear down/rebuild on every
  // render when the caller passes an inline arrow function.
  const listenerRef = useRef(listener);
  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    if (!accessToken || !selfBroadcasterId || !channelId) {
      setConnectionState("idle");
      return;
    }
    const client: TwitchEventSubClient = getTwitchEventSubClient(
      accessToken,
      selfBroadcasterId,
    );

    // Seed state from current client, then keep it in sync.
    setConnectionState(client.connectionState);
    const unsubState = client.onConnectionStateChange((state) => {
      setConnectionState(state);
    });

    const unsubEvent = client.subscribe<E>(eventType, channelId, (payload) => {
      listenerRef.current(payload);
    });

    return () => {
      unsubEvent();
      unsubState();
    };
  }, [accessToken, selfBroadcasterId, channelId, eventType]);

  return { connectionState };
}
