/**
 * BTTV REST in the main process (Electron `net.fetch`, Node-side) so the
 * 404s for Twitch channels with no BTTV emote set never reach renderer
 * DevTools. Same pattern as 7TV — see ADR-0004.
 */

import { net } from "electron";

import type { BTTVBadgeCatalog } from "@/shared/ipc-channels";
import { runBoundedJsonRead } from "@/backend/reliability/bounded-json-read";
import {
  bttvBadgeCatalogSchema,
  bttvEmoteListSchema,
  bttvUserSchema,
} from "@/ipc-contracts/third-party-emote-schemas";

const BTTV_V3_BASE = "https://api.betterttv.net/3";

export async function fetchBTTVBadges(): Promise<BTTVBadgeCatalog> {
  return runBoundedJsonRead({
    dependency: "bttv",
    attempt: (signal) => net.fetch(`${BTTV_V3_BASE}/cached/badges`, { signal }),
    decode: (value) => bttvBadgeCatalogSchema.parse(value),
  });
}

export async function fetchBTTVGlobalEmotes(): Promise<unknown> {
  return runBoundedJsonRead({
    dependency: "bttv",
    attempt: (signal) => net.fetch(`${BTTV_V3_BASE}/cached/emotes/global`, { signal }),
    decode: (value) => bttvEmoteListSchema.parse(value),
  });
}

export async function fetchBTTVUserByTwitchId(channelId: string): Promise<unknown | null> {
  return runBoundedJsonRead({
    dependency: "bttv",
    notFound: "return-null",
    attempt: (signal) => net.fetch(`${BTTV_V3_BASE}/cached/users/twitch/${channelId}`, { signal }),
    decode: (value) => bttvUserSchema.parse(value),
  });
}
