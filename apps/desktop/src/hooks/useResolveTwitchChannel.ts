/**
 * useResolveTwitchChannel
 *
 * Resolves a Twitch `broadcaster_login` (the URL param used by Stream and
 * Mod pages) into the numeric `broadcaster_id` via Helix `/users?login=`.
 *
 * Returns `{ id, login, displayName }` on success, `null` on 404 / 401 /
 * any network failure, and `undefined` while still loading. The hook
 * intentionally does not retry — the parent page renders a loading skeleton
 * until the value lands.
 *
 * Dev override: when `useDevModOverrideStore.forceResolvedTwitchBroadcasterId`
 * is a non-empty string, the hook returns it as the resolved id without
 * calling Helix. Lets `/mod/twitch/<login>` mount its broadcaster-id-
 * dependent sections without a signed-in Twitch session. Cleared by default.
 */

import { useEffect, useState } from "react";

import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

const HELIX_BASE = "https://api.twitch.tv/helix";

export interface ResolvedTwitchChannel {
  id: string;
  login: string;
  displayName: string;
}

interface HelixUsersResponse {
  data?: Array<{ id: string; login: string; display_name: string }>;
}

export function useResolveTwitchChannel(
  login: string | null | undefined,
): ResolvedTwitchChannel | null | undefined {
  const forceId = useDevModOverrideStore(
    (s) => s.forceResolvedTwitchBroadcasterId,
  );
  const [state, setState] = useState<ResolvedTwitchChannel | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!login) {
      setState(null);
      return;
    }

    // Dev override short-circuits Helix entirely.
    if (forceId) {
      setState({
        id: forceId,
        login: login.trim().toLowerCase(),
        displayName: login,
      });
      return;
    }

    let cancelled = false;
    setState(undefined);

    (async () => {
      try {
        const token = await window.electronAPI.auth.getToken("twitch");
        const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
        if (!token?.accessToken || !clientId) {
          if (!cancelled) setState(null);
          return;
        }
        const url = `${HELIX_BASE}/users?login=${encodeURIComponent(login.trim().toLowerCase())}`;
        const res = await fetch(url, {
          headers: {
            "Client-Id": clientId,
            Authorization: `Bearer ${token.accessToken}`,
          },
        });
        if (!res.ok) {
          if (!cancelled) setState(null);
          return;
        }
        const body = (await res.json()) as HelixUsersResponse;
        const first = body.data?.[0];
        if (!first) {
          if (!cancelled) setState(null);
          return;
        }
        if (!cancelled) {
          setState({ id: first.id, login: first.login, displayName: first.display_name });
        }
      } catch {
        if (!cancelled) setState(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [login, forceId]);

  return state;
}
