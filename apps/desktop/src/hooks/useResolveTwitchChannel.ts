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

export interface ResolvedTwitchChannel {
  id: string;
  login: string;
  displayName: string;
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
        const result = await window.electronAPI.twitch.execute({
          operation: "resolve-channel",
          login: login!.trim().toLowerCase(),
        });
        return result.ok ? (result.data as ResolvedTwitchChannel | null) : null;
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
