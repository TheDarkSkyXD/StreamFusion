/**
 * Kick native channel emotes via main-process transport.
 *
 * These Kick web endpoints commonly return 404 for channels with no emote set
 * or renamed/missing channels. Keeping the fetches in main prevents expected
 * 404 probes from showing as red renderer DevTools network errors.
 */

import { net } from "electron";

import { logger } from "@/backend/logging/logger";

const KICK_WEB_BASE = "https://kick.com";
const REQUEST_TIMEOUT_MS = 5000;

export interface KickChannelEmotesPayload {
  emoteSets?: unknown;
  channelData?: unknown;
}

async function readJson(res: Response, context: string): Promise<unknown | null> {
  try {
    return await res.json();
  } catch (error) {
    logger.warn("Emote:Kick", "Kick emote endpoint returned non-JSON response", {
      context,
      status: res.status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  }
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<Response | null> {
  try {
    return await net.fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn("Emote:Kick", "Kick emote endpoint request failed", {
      url,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  }
}

/**
 * Legacy/internal Kick web endpoints.
 *
 * Kick's public API does not currently expose channel-native emote inventory.
 * The web client uses `/emotes/{slug}` first, while `/api/v1/channels/{slug}`
 * can carry older `emotes` / `chatroom.emotes` arrays as a fallback.
 */
export async function fetchKickChannelEmotes(
  slug: string,
  accessToken?: string
): Promise<KickChannelEmotesPayload | null> {
  const normalizedSlug = slug.trim();
  if (!normalizedSlug) return null;

  const encodedSlug = encodeURIComponent(normalizedSlug);
  const baseHeaders = {
    Accept: "application/json",
    Referer: "https://kick.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  const emotesRes = await fetchJson(`${KICK_WEB_BASE}/emotes/${encodedSlug}`, baseHeaders);
  if (emotesRes?.ok) {
    const emoteSets = await readJson(emotesRes, "emotes");
    return emoteSets ? { emoteSets } : null;
  }
  if (emotesRes && emotesRes.status !== 404) {
    logger.info("Emote:Kick", "Kick emotes endpoint unavailable", {
      slug: normalizedSlug,
      status: emotesRes.status,
    });
  }

  const channelHeaders = {
    ...baseHeaders,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
  const channelRes = await fetchJson(
    `${KICK_WEB_BASE}/api/v1/channels/${encodedSlug}`,
    channelHeaders
  );
  if (channelRes?.ok) {
    const channelData = await readJson(channelRes, "channel");
    return channelData ? { channelData } : null;
  }
  if (channelRes && channelRes.status !== 404) {
    logger.info("Emote:Kick", "Kick channel emote fallback unavailable", {
      slug: normalizedSlug,
      status: channelRes.status,
    });
  }

  return null;
}
