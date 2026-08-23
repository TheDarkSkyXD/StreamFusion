/**
 * 7TV REST in the main process (Electron `net.fetch`, Node-side) so the
 * 404s for Kick users with no linked 7TV account never reach renderer
 * DevTools. See PRD #62.
 */

import { net } from "electron";

import type { Platform } from "@/shared/auth-types";
import { runBoundedJsonRead } from "@/backend/reliability/bounded-json-read";
import { sevenTvGlobalSetSchema, sevenTvUserSchema } from "./third-party-emote-schemas";

const SEVENTV_V3_BASE = "https://7tv.io/v3";

// 7TV routes by exact case on the platform segment — lowercase 404s.
export async function fetch7TVUserByConnection(
  platform: Platform,
  identifier: string
): Promise<unknown | null> {
  const alias = platform.toUpperCase();
  return runBoundedJsonRead({
    dependency: "7tv",
    notFound: "return-null",
    attempt: (signal) => net.fetch(`${SEVENTV_V3_BASE}/users/${alias}/${identifier}`, { signal }),
    decode: (value) => sevenTvUserSchema.parse(value),
  });
}

export async function fetch7TVGlobalEmoteSet(): Promise<unknown> {
  return runBoundedJsonRead({
    dependency: "7tv",
    attempt: (signal) => net.fetch(`${SEVENTV_V3_BASE}/emote-sets/global`, { signal }),
    decode: (value) => sevenTvGlobalSetSchema.parse(value),
  });
}
