import type { TwitchEventSubClient } from "./twitch-eventsub-client";
import type { TwitchEventSubConnectionState } from "./twitch-eventsub-types";
import { recordPlatformFailure, recordPlatformSuccess } from "../../unified/platform-health";

export const EVENTSUB_DISCONNECT_DEBOUNCE_MS = 5_000;

export function attachEventSubHealthBridge(client: TwitchEventSubClient): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  const unsubState = client.onConnectionStateChange((state: TwitchEventSubConnectionState) => {
    if (state === "reconnecting") {
      if (debounceTimer === null) {
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          recordPlatformFailure("twitch", "net-error");
        }, EVENTSUB_DISCONNECT_DEBOUNCE_MS);
      }
      return;
    }

    if (state === "connected") {
      clearDebounce();
      recordPlatformSuccess("twitch");
      return;
    }

    if (state === "error") {
      clearDebounce();
      recordPlatformFailure("twitch", "net-error");
      return;
    }
  });

  return () => {
    clearDebounce();
    unsubState();
  };
}
