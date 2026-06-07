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

import { useQuery } from "@tanstack/react-query";

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
  login: string | null | undefined
): ResolvedTwitchChannel | null | undefined {
  const forceId = useDevModOverrideStore((s) => s.forceResolvedTwitchBroadcasterId);

  const query = useQuery<ResolvedTwitchChannel | null>({
    queryKey: ["resolveTwitchChannel", login, forceId],
    queryFn: async () => {
      // login is non-null here — `enabled` below gates on it.
      if (forceId) {
        return {
          id: forceId,
          login: login!.trim().toLowerCase(),
          displayName: login!,
        };
      }
      try {
        const token = await window.electronAPI.auth.getToken("twitch");
        const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
        if (!token?.accessToken || !clientId) return null;

        const url = `${HELIX_BASE}/users?login=${encodeURIComponent(login!.trim().toLowerCase())}`;
        const res = await fetch(url, {
          headers: {
            "Client-Id": clientId,
            Authorization: `Bearer ${token.accessToken}`,
          },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as HelixUsersResponse;
        const first = body.data?.[0];
        if (!first) return null;
        return { id: first.id, login: first.login, displayName: first.display_name };
      } catch {
        return null;
      }
    },
    enabled: !!login,
    retry: false,
  });

  if (!login) return null;
  return query.data;
}
