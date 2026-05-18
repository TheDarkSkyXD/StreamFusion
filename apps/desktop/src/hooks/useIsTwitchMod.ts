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
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

export function useIsTwitchMod(channelId?: string | null): boolean {
  const twitchUser = useAuthStore((state) => state.twitchUser);
  const moddedIds = useModeratedChannelsStore((state) => state.twitchModeratedChannelIds);

  if (!channelId) return false;
  if (!twitchUser) return false;
  // Broadcaster moderates their own channel by definition.
  if (twitchUser.id === channelId) return true;
  return moddedIds.has(channelId);
}
