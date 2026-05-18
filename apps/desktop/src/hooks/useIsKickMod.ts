/**
 * useIsKickMod
 *
 * Returns `true` when the signed-in user can moderate the given Kick channel.
 * Today this short-circuits to "user IS the broadcaster" — Kick does not
 * expose a public "channels I moderate" endpoint the way Twitch's Helix
 * `/moderation/channels` does, so cross-channel mod detection is a future
 * follow-up that would need either cookie-jar auth + scraping or a Kick
 * Dev API endpoint we don't currently have access to.
 *
 * The dev debug-panel override (forceModRole) is honored so the mod UI can
 * be tested without an actual moderated channel.
 *
 * Returns `false` for null/empty inputs and when no Kick user is signed in.
 */

import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

export function useIsKickMod(channelSlug?: string | null): boolean {
  const kickUser = useAuthStore((state) => state.kickUser);
  const forceMod = useDevModOverrideStore((s) => s.forceModRole);

  if (forceMod) return true;
  if (!channelSlug) return false;
  if (!kickUser) return false;
  // Broadcaster moderates their own channel. Match on slug (case-insensitive)
  // and username as a defensive fallback — Kick slugs are normally identical
  // to the lowercased username but occasionally diverge for legacy accounts.
  const slug = channelSlug.toLowerCase();
  return (
    (typeof kickUser.slug === "string" && kickUser.slug.toLowerCase() === slug) ||
    (typeof kickUser.username === "string" && kickUser.username.toLowerCase() === slug)
  );
}
