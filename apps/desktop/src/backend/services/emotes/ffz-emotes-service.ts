/**
 * FFZ REST in the main process (Electron `net.fetch`, Node-side). Same
 * pattern as 7TV and BTTV — see ADR-0004.
 */

import { net } from "electron";

const FFZ_V1_BASE = "https://api.frankerfacez.com/v1";

export async function fetchFFZGlobalEmotes(): Promise<unknown> {
  const res = await net.fetch(`${FFZ_V1_BASE}/set/global`);
  if (!res.ok) throw new Error(`FFZ global fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchFFZRoom(opts: {
  name?: string;
  channelId?: string;
}): Promise<unknown | null> {
  const url = opts.name
    ? `${FFZ_V1_BASE}/room/${opts.name.toLowerCase()}`
    : `${FFZ_V1_BASE}/room/id/${opts.channelId}`;
  const res = await net.fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`FFZ room fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}
