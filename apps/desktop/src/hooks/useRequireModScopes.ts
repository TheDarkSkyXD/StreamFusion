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

import { useEffect, useState } from "react";

import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

const REQUIRED_MOD_SCOPES = [
  "user:read:moderated_channels",
  "moderator:manage:chat_messages",
] as const;

export interface PromptReconnectOptions {
  missingScopes?: string[];
  onReconnected?: () => void;
}

export interface UseRequireModScopesResult {
  /** True once the token has been inspected AND it carries every required scope. */
  hasModScopes: boolean;
  /** True while the initial token read is in flight. */
  loading: boolean;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!twitchUser) {
      setHasModScopes(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const token = await window.electronAPI.auth.getToken("twitch");
        if (cancelled) return;
        const scopes = new Set(token?.scope ?? []);
        const ok = REQUIRED_MOD_SCOPES.every((s) => scopes.has(s));
        setHasModScopes(ok);
      } catch {
        if (!cancelled) setHasModScopes(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [twitchUser]);

  const promptReconnect = (options?: PromptReconnectOptions) => {
    useReconnectDialogStore.getState().open({
      missingScopes: options?.missingScopes ?? [...REQUIRED_MOD_SCOPES],
      onReconnected: options?.onReconnected,
    });
  };

  // Dev override wins. Lets the debug panel test the post-scope action path
  // without needing a token that actually carries the new scopes.
  return {
    hasModScopes: forceScopes || hasModScopes,
    loading: forceScopes ? false : loading,
    promptReconnect,
  };
}
