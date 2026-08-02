/**
 * BTTV REST in the main process (Electron `net.fetch`, Node-side) so the
 * 404s for Twitch channels with no BTTV emote set never reach renderer
 * DevTools. Same pattern as 7TV — see ADR-0004.
 */

import { net } from "electron";

import type { BTTVBadgeCatalog } from "@/shared/ipc-channels";

const BTTV_V3_BASE = "https://api.betterttv.net/3";

export async function fetchBTTVBadges(): Promise<BTTVBadgeCatalog> {
  const res = await net.fetch(`${BTTV_V3_BASE}/cached/badges`);
  if (!res.ok) throw new Error(`BTTV badge fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchBTTVGlobalEmotes(): Promise<unknown> {
  const res = await net.fetch(`${BTTV_V3_BASE}/cached/emotes/global`);
  if (!res.ok) throw new Error(`BTTV global fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchBTTVUserByTwitchId(channelId: string): Promise<unknown | null> {
  const res = await net.fetch(`${BTTV_V3_BASE}/cached/users/twitch/${channelId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BTTV user fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}
