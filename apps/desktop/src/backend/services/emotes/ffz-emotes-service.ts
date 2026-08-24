/**
 * FFZ REST in the main process (Electron `net.fetch`, Node-side). Same
 * pattern as 7TV and BTTV — see ADR-0004.
 */

import { net } from "electron";

import type { FFZBadgeCatalog, FFZRoomResponse } from "@/shared/ipc-channels";
import { runBoundedJsonRead } from "@/backend/reliability/bounded-json-read";
import type { FfzRoomRequest } from "@/ipc-contracts/emote-contracts";
import {
  ffzBadgeCatalogSchema,
  ffzGlobalSchema,
  ffzRoomSchema,
} from "@/ipc-contracts/third-party-emote-schemas";

const FFZ_V1_BASE = "https://api.frankerfacez.com/v1";

export async function fetchFFZBadges(): Promise<FFZBadgeCatalog> {
  return runBoundedJsonRead({
    dependency: "ffz",
    attempt: (signal) => net.fetch(`${FFZ_V1_BASE}/badges/ids`, { signal }),
    decode: (value) => ffzBadgeCatalogSchema.parse(value),
  });
}

export async function fetchFFZGlobalEmotes(): Promise<unknown> {
  return runBoundedJsonRead({
    dependency: "ffz",
    attempt: (signal) => net.fetch(`${FFZ_V1_BASE}/set/global`, { signal }),
    decode: (value) => ffzGlobalSchema.parse(value),
  });
}

export async function fetchFFZRoom(request: FfzRoomRequest): Promise<FFZRoomResponse | null> {
  const url =
    request.kind === "name"
      ? `${FFZ_V1_BASE}/room/${request.name.toLowerCase()}`
      : `${FFZ_V1_BASE}/room/id/${request.channelId}`;
  return runBoundedJsonRead({
    dependency: "ffz",
    notFound: "return-null",
    attempt: (signal) => net.fetch(url, { signal }),
    decode: (value) => ffzRoomSchema.parse(value),
  });
}
