/**
 * Kick native channel emotes via main-process transport.
 *
 * These legacy Kick web endpoints run through the persistent Kick session so
 * they reuse the same Cloudflare and authenticated browser state as other
 * kick.com reads without surfacing expected failures in renderer DevTools.
 */

import { session } from "electron";

import { acquireKickRequestSlot } from "@/backend/api/platforms/kick/kick-network-health";
import { logger } from "@/backend/logging/logger";

const KICK_WEB_BASE = "https://kick.com";
const KICK_PUBLIC_PARTITION = "persist:kick_public";
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 30 * 60 * 1_000;
const TRANSIENT_FAILURE_COOLDOWN_MS = 30_000;

export interface KickChannelEmotesPayload {
  emoteSets?: unknown;
  channelData?: unknown;
}

interface CacheEntry {
  payload: KickChannelEmotesPayload;
  cachedAt: number;
}

interface CompactError {
  name: string;
  message: string;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<KickChannelEmotesPayload | null>>();
let transientFailureCooldownUntil = 0;

function compactError(error: unknown): CompactError {
  if (error instanceof Error || error instanceof DOMException) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

function httpError(status: number): CompactError {
  return { name: "HttpError", message: `HTTP ${status}` };
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function warnRequestFailure(
  slug: string,
  endpoint: "emotes" | "channel",
  error: CompactError,
  servedStale: boolean
): void {
  logger.warn("Emote:Kick", "Kick emote request failed", {
    slug,
    endpoint,
    error,
    servedStale,
  });
}

async function fetchUncached(
  slug: string,
  accessToken: string | undefined,
  stale: KickChannelEmotesPayload | null
): Promise<KickChannelEmotesPayload | null> {
  const kickSession = session.fromPartition(KICK_PUBLIC_PARTITION);
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const baseHeaders: Record<string, string> = {
    Accept: "application/json",
    Referer: "https://kick.com/",
    "User-Agent": kickSession.getUserAgent(),
  };
  const encodedSlug = encodeURIComponent(slug);
  const releaseSlot = await acquireKickRequestSlot();
  let endpoint: "emotes" | "channel" = "emotes";

  try {
    const emotesResponse = await kickSession.fetch(`${KICK_WEB_BASE}/emotes/${encodedSlug}`, {
      credentials: "include",
      headers: baseHeaders,
      signal,
    });

    if (emotesResponse.ok) {
      const emoteSets = await readJson(emotesResponse);
      if (!Array.isArray(emoteSets)) {
        warnRequestFailure(
          slug,
          endpoint,
          { name: "PayloadError", message: "Unexpected Kick emote payload" },
          Boolean(stale)
        );
        return stale;
      }
      if (emoteSets.length > 0) {
        return { emoteSets };
      }
    } else if (emotesResponse.status !== 404) {
      const transient = isTransientStatus(emotesResponse.status);
      if (transient) transientFailureCooldownUntil = Date.now() + TRANSIENT_FAILURE_COOLDOWN_MS;
      warnRequestFailure(slug, endpoint, httpError(emotesResponse.status), Boolean(stale));
      return stale;
    }

    endpoint = "channel";
    const channelResponse = await kickSession.fetch(
      `${KICK_WEB_BASE}/api/v1/channels/${encodedSlug}`,
      {
        credentials: "include",
        headers: {
          ...baseHeaders,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        signal,
      }
    );

    if (!channelResponse.ok) {
      if (channelResponse.status === 404) return stale;
      const transient = isTransientStatus(channelResponse.status);
      if (transient) transientFailureCooldownUntil = Date.now() + TRANSIENT_FAILURE_COOLDOWN_MS;
      warnRequestFailure(slug, endpoint, httpError(channelResponse.status), Boolean(stale));
      return stale;
    }

    const channelData = await readJson(channelResponse);
    if (!isRecord(channelData)) {
      warnRequestFailure(
        slug,
        endpoint,
        { name: "PayloadError", message: "Unexpected Kick channel payload" },
        Boolean(stale)
      );
      return stale;
    }
    return { channelData };
  } catch (error) {
    transientFailureCooldownUntil = Date.now() + TRANSIENT_FAILURE_COOLDOWN_MS;
    warnRequestFailure(slug, endpoint, compactError(error), Boolean(stale));
    return stale;
  } finally {
    releaseSlot();
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
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) return null;

  const now = Date.now();
  const cached = cache.get(normalizedSlug);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.payload;
  }
  if (now < transientFailureCooldownUntil) {
    return cached?.payload ?? null;
  }

  const pending = inFlight.get(normalizedSlug);
  if (pending) return pending;

  const request = fetchUncached(normalizedSlug, accessToken, cached?.payload ?? null).then(
    (payload) => {
      if (payload && payload !== cached?.payload) {
        cache.set(normalizedSlug, { payload, cachedAt: Date.now() });
      }
      return payload;
    }
  );
  inFlight.set(normalizedSlug, request);

  try {
    return await request;
  } finally {
    if (inFlight.get(normalizedSlug) === request) {
      inFlight.delete(normalizedSlug);
    }
  }
}
