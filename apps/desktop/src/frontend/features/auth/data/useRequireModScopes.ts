/**
 * useRequireModScopes
 *
 * Reports whether the signed-in Twitch token carries the OAuth scopes the
 * mod surface needs (`moderator:manage:chat_messages` + `user:read:moderated_channels`),
 * and provides a `promptReconnect()` that opens the lazy re-consent dialog.
 *
 * Existing users connected before U7 landed have tokens without these scopes.
 * Rather than force a proactive reconnect on app start, this hook is read by
 * each mod-action entry point (Pin, Unpin, etc.) so the dialog only appears
 * the first time someone tries a mod action — non-mod users never see it.
 *
 * The hook is reactive to login/logout transitions via `useAuthStore`.
 * Scope checking is async (reads the persisted token via electronAPI) but
 * the cached result is exposed synchronously after the first read.
 *
 * U5 — `promptReconnect` now accepts an options bag so callers in the
 * channel-management console can prompt for any subset of scopes the action
 * needs and register a one-shot retry callback. Existing call sites that
 * pass no args fall back to the two pin-path scopes.
 */

import { useCallback, useEffect, useState } from "react";

import {
  TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPE_GROUPS,
  TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES,
  TWITCH_MOD_ACTION_SCOPES,
} from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

export interface PromptReconnectOptions {
  missingScopes?: string[];
  onReconnected?: () => void;
}

export interface UseRequireModScopesResult {
  /** True once the token has been inspected AND it carries every required scope. */
  hasModScopes: boolean;
  /** True while the initial token read is in flight. */
  loading: boolean;
  /** Actual token authority for the eight scope groups required by channel.moderate v2. */
  hasChannelModerateEventSubScopes: boolean;
  /** Canonical scopes absent from the inspected token. */
  missingChannelModerateEventSubScopes: string[];
  /**
   * Opens the singleton "Reconnect for mod features" dialog.
   *
   * With no args, defaults to the existing pin-path two-scope list. Pass
   * `missingScopes` to surface every scope the just-attempted action needs,
   * and `onReconnected` to fire a retry callback once consent succeeds.
   */
  promptReconnect: (options?: PromptReconnectOptions) => void;
}

export function useRequireModScopes(): UseRequireModScopesResult {
  const twitchUser = useAuthStore((state) => state.twitchUser);
  // Dev debug-panel override — see dev-mod-override-store.
  const forceScopes = useDevModOverrideStore((s) => s.forceModScopes);
  const [hasModScopes, setHasModScopes] = useState(false);
  const [missingChannelModerateEventSubScopes, setMissingChannelModerateEventSubScopes] = useState<
    string[]
  >([...TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!twitchUser) {
      setHasModScopes(false);
      setMissingChannelModerateEventSubScopes([...TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const scopeStatus = await window.electronAPI.auth.tokenStatus("twitch");
        if (cancelled) return;
        const scopes = new Set(scopeStatus.scopes);
        const ok = TWITCH_MOD_ACTION_SCOPES.every((s) => scopes.has(s));
        setHasModScopes(ok);
        setMissingChannelModerateEventSubScopes(
          TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPE_GROUPS.filter(
            (group) => !group.accepted.some((scope) => scopes.has(scope))
          ).map((group) => group.canonical)
        );
      } catch {
        if (!cancelled) {
          setHasModScopes(false);
          setMissingChannelModerateEventSubScopes([...TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [twitchUser]);

  const promptReconnect = useCallback((options?: PromptReconnectOptions) => {
    useReconnectDialogStore.getState().open({
      platform: "twitch",
      missingScopes: options?.missingScopes ?? [...TWITCH_MOD_ACTION_SCOPES],
      onReconnected: options?.onReconnected,
    });
  }, []);

  // Dev override wins. Lets the debug panel test the post-scope action path
  // without needing a token that actually carries the new scopes.
  return {
    hasModScopes: forceScopes || hasModScopes,
    // Dev scope overrides exist for fixture UI only and must never authorize
    // a real EventSub subscription against Twitch.
    hasChannelModerateEventSubScopes: missingChannelModerateEventSubScopes.length === 0,
    missingChannelModerateEventSubScopes,
    loading: forceScopes ? false : loading,
    promptReconnect,
  };
}
