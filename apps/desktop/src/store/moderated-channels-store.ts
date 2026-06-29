/**
 * Moderated-Channels Store
 *
 * Tracks which channels the signed-in user moderates. Twitch is hydrated post-
 * login via the Helix `/moderation/channels` endpoint (see
 * `twitch-helix-moderation.ts`); Kick is updated from live observed self-badges
 * because Kick does not expose a Helix-equivalent moderated channels endpoint.
 *
 * Hydration policy:
 *   - Fire-and-forget on login (AuthProvider wires this).
 *   - Re-hydrate in the background when the cache is stale (> STALE_MS).
 *   - Reads stay synchronous: even when stale, the hook returns the cached
 *     value immediately while a background refresh kicks off.
 *   - Cleared on logout.
 *
 * Why not persist this to disk: mod-channel membership changes server-side
 * at any time, and a stale value gating a pin/unpin click results in either
 * a confusing 401 toast or — worse — a silent no-op. Always pulling fresh
 * on login keeps the gate honest.
 */

import { create } from "zustand";

import {
  getModeratedChannels,
  type ModeratedChannel,
} from "@/backend/api/platforms/twitch/twitch-helix-moderation";

const STALE_MS = 5 * 60_000; // 5 min

interface ModeratedChannelsState {
  /** Set of Twitch broadcaster ids the user moderates. */
  twitchModeratedChannelIds: Set<string>;
  /** Set of Kick channel slugs the user moderates, normalized to lowercase. */
  kickModeratedChannelSlugs: Set<string>;
  /** Last successful hydrate timestamp (ms epoch). null until first hydrate. */
  hydratedAt: number | null;
  /** True while a hydrate call is in flight. */
  hydrating: boolean;

  /** Trigger a hydrate. Safe to call repeatedly — concurrent calls dedupe. */
  hydrate: (selfUserId: string, accessToken: string, clientId: string) => Promise<void>;
  /** Apply a live Twitch IRC mod/unmod update for one broadcaster id. */
  setTwitchChannelModState: (channelId: string, isModerator: boolean) => void;
  /** Apply a live Kick badge-derived mod/unmod update for one channel slug. */
  setKickChannelModState: (channelSlug: string, isModerator: boolean) => void;
  /** Returns true if the cache is stale (or never hydrated). */
  isStale: () => boolean;
  /** Clear Twitch moderated-channel data without touching Kick live role state. */
  clearTwitch: () => void;
  /** Clear Kick moderated-channel data without touching Twitch hydrate state. */
  clearKick: () => void;
  /** Wipe all cached data; called on logout. */
  clear: () => void;
}

export const useModeratedChannelsStore = create<ModeratedChannelsState>()((set, get) => ({
  twitchModeratedChannelIds: new Set<string>(),
  kickModeratedChannelSlugs: new Set<string>(),
  hydratedAt: null,
  hydrating: false,

  hydrate: async (selfUserId, accessToken, clientId) => {
    if (get().hydrating) return;
    set({ hydrating: true });
    try {
      const channels: ModeratedChannel[] = await getModeratedChannels(
        selfUserId,
        accessToken,
        clientId
      );
      // The broadcaster's OWN channel is mod-equivalent for our purposes but
      // not included by Helix. {@link useIsTwitchMod} handles the self check
      // separately; we only store the actual moderated-channels list here.
      const ids = new Set(channels.map((c) => c.broadcaster_id));
      set({
        twitchModeratedChannelIds: ids,
        hydratedAt: Date.now(),
        hydrating: false,
      });
    } catch {
      // Helix wrapper already silences 401s; any error reaching here is
      // network-side. Leave the previous cache in place and let the next
      // hydrate retry pick it up.
      set({ hydrating: false });
    }
  },

  setTwitchChannelModState: (channelId, isModerator) => {
    if (!channelId) return;
    const current = get().twitchModeratedChannelIds;
    if (isModerator === current.has(channelId)) return;
    const next = new Set(current);
    if (isModerator) {
      next.add(channelId);
    } else {
      next.delete(channelId);
    }
    set({ twitchModeratedChannelIds: next });
  },

  setKickChannelModState: (channelSlug, isModerator) => {
    const normalizedSlug = channelSlug.trim().toLowerCase();
    if (!normalizedSlug) return;
    const current = get().kickModeratedChannelSlugs;
    if (isModerator === current.has(normalizedSlug)) return;
    const next = new Set(current);
    if (isModerator) {
      next.add(normalizedSlug);
    } else {
      next.delete(normalizedSlug);
    }
    set({ kickModeratedChannelSlugs: next });
  },

  isStale: () => {
    const { hydratedAt } = get();
    return hydratedAt === null || Date.now() - hydratedAt > STALE_MS;
  },

  clearTwitch: () => {
    set({
      twitchModeratedChannelIds: new Set<string>(),
      hydratedAt: null,
      hydrating: false,
    });
  },

  clearKick: () => {
    set({ kickModeratedChannelSlugs: new Set<string>() });
  },

  clear: () => {
    set({
      twitchModeratedChannelIds: new Set<string>(),
      kickModeratedChannelSlugs: new Set<string>(),
      hydratedAt: null,
      hydrating: false,
    });
  },
}));
