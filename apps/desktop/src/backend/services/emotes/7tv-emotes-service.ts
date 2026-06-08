/**
 * 7TV REST in the main process (Electron `net.fetch`, Node-side) so the
 * 404s for Kick users with no linked 7TV account never reach renderer
 * DevTools. See PRD #62.
 */

import { net } from "electron";

import type { Platform } from "@/shared/auth-types";

const SEVENTV_V3_BASE = "https://7tv.io/v3";

// 7TV routes by exact case on the platform segment — lowercase 404s.
export async function fetch7TVUserByConnection(
  platform: Platform,
  identifier: string
): Promise<unknown | null> {
  const alias = platform.toUpperCase();
  const res = await net.fetch(`${SEVENTV_V3_BASE}/users/${alias}/${identifier}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`7TV user fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetch7TVGlobalEmoteSet(): Promise<unknown> {
  const res = await net.fetch(`${SEVENTV_V3_BASE}/emote-sets/global`);
  if (!res.ok) throw new Error(`7TV global set fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}
