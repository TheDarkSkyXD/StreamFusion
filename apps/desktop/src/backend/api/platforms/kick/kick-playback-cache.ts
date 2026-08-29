import type { StreamPlayback } from "../../../../frontend/features/playback/components/player/types";

const KICK_PLAYBACK_CACHE_TTL_MS = 90_000;

type CachedKickPlayback = StreamPlayback & {
  cachedAt: number;
  expiresAt: number;
  sourceField: "playback_url" | "livestream.source";
};

const livePlaybackCache = new Map<string, CachedKickPlayback>();

function normalizeSlug(slug: string): string {
  return slug.toLowerCase().trim();
}

function getPlaybackUrlFromChannelPayload(
  data: KickPlaybackChannelPayload
): { url: string; sourceField: CachedKickPlayback["sourceField"] } | null {
  const playbackUrl = data?.playback_url || data?.livestream?.source || null;
  if (!playbackUrl) return null;
  return {
    url: playbackUrl,
    sourceField: data?.playback_url ? "playback_url" : "livestream.source",
  };
}

interface KickPlaybackChannelPayload {
  playback_url?: string;
  livestream?: { source?: string; is_live?: boolean } | null;
}

function isKickPlaybackChannelPayload(value: unknown): value is KickPlaybackChannelPayload {
  if (typeof value !== "object" || value === null) return false;
  if ("playback_url" in value && value.playback_url !== undefined && typeof value.playback_url !== "string") return false;
  if (!("livestream" in value) || value.livestream === null || value.livestream === undefined) return true;
  if (typeof value.livestream !== "object") return false;
  return (!('source' in value.livestream) || value.livestream.source === undefined || typeof value.livestream.source === "string") &&
    (!('is_live' in value.livestream) || value.livestream.is_live === undefined || typeof value.livestream.is_live === "boolean");
}

export function rememberKickLivePlaybackFromChannelPayload(slug: string, data: unknown): boolean {
  const key = normalizeSlug(slug);
  if (!isKickPlaybackChannelPayload(data)) {
    livePlaybackCache.delete(key);
    return false;
  }
  const livestream = data?.livestream;

  if (!livestream || livestream.is_live === false) {
    livePlaybackCache.delete(key);
    return false;
  }

  const playback = getPlaybackUrlFromChannelPayload(data);
  if (!playback) {
    livePlaybackCache.delete(key);
    return false;
  }

  const now = Date.now();
  livePlaybackCache.set(key, {
    url: playback.url,
    format: "hls",
    cachedAt: now,
    expiresAt: now + KICK_PLAYBACK_CACHE_TTL_MS,
    sourceField: playback.sourceField,
  });
  return true;
}

export function getCachedKickLivePlayback(slug: string):
  | (StreamPlayback & {
      ageMs: number;
      sourceField: CachedKickPlayback["sourceField"];
    })
  | null {
  const key = normalizeSlug(slug);
  const cached = livePlaybackCache.get(key);
  if (!cached) return null;

  const now = Date.now();
  if (now >= cached.expiresAt) {
    livePlaybackCache.delete(key);
    return null;
  }

  return {
    url: cached.url,
    format: cached.format,
    ageMs: now - cached.cachedAt,
    sourceField: cached.sourceField,
  };
}

export function __clearKickPlaybackCacheForTests(): void {
  livePlaybackCache.clear();
}
