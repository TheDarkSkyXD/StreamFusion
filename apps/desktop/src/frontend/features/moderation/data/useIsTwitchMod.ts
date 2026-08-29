/**
 * useIsTwitchMod
 *
 * Returns `true` when the signed-in user can moderate the given Twitch
 * channel. Two paths qualify:
 *   - The user moderates the channel (cached in {@link useModeratedChannelsStore}).
 *   - The user IS the channel's broadcaster (Helix doesn't list your own
 *     channel in `/moderation/channels`, so we bridge that here).
 *
 * Safe to call with `null`/`undefined` channelId — always returns `false`
 * in that case. Also returns `false` when no Twitch user is signed in.
 *
 * The hook is read-only: it does NOT trigger a hydrate. Hydration is the
 * AuthProvider's job (on login) plus a self-refresh from the store when
 * the cache is stale beyond {@link useModeratedChannelsStore}'s threshold.
 */

import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import { useModeratedChannelsStore } from "@/features/moderation/data/moderated-channels-store";

function hasActualTwitchModAuthority(
  channelId: string | null | undefined,
  twitchUserId: string | undefined,
  moddedIds: Set<string>
): boolean {
  if (!channelId || !twitchUserId) return false;
  return twitchUserId === channelId || moddedIds.has(channelId);
}

/** Real Twitch-backed authority only; intentionally ignores dev UI overrides. */
export function useHasActualTwitchModAuthority(channelId?: string | null): boolean {
  const twitchUser = useAuthStore((state) => state.twitchUser);
  const moddedIds = useModeratedChannelsStore((state) => state.twitchModeratedChannelIds);

  return hasActualTwitchModAuthority(channelId, twitchUser?.id, moddedIds);
}

export function useIsTwitchMod(channelId?: string | null): boolean {
  const actualAuthority = useHasActualTwitchModAuthority(channelId);
  // Dev debug-panel override — lets the ChatSimTool force mod UI without
  // needing an actual mod token. Off by default, no production impact.
  const forceMod = useDevModOverrideStore((s) => s.forceModRole);

  if (forceMod) return true;
  return actualAuthority;
}
