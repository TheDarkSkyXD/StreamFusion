import { logger } from "@/backend/logging/logger";
import { normalizeKickDate } from "../kick-transformers";
import {
  KICK_LEGACY_API_V2_BASE,
  type PaginatedResult,
  type PaginationOptions,
} from "../kick-types";

/**
 * Get videos by channel slug using legacy API
 */
export async function getVideosByChannelSlug(
  slug: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<any>> {
  // Using any for now to map to UI
  try {
    const { net } = require("electron");
    const limit = options.limit || 20;
    const cursor = options.cursor || 0;
    // Map sort option: 'views' -> 'view', 'date' -> 'date' (Kick API uses 'view' not 'views')
    const sortParam = options.sort === "views" ? "view" : "date";

    // Switch to V2 API to match clips implementation.
    // `_=Date.now()` is a CDN cache-buster: without it, Kick's edge keeps
    // serving the just-ended stream's VOD with is_live=true / duration=0 /
    // partial views for minutes after finalisation, so the videos tab stays
    // stuck on the LIVE-badged card after the player flips to offline.
    const cacheBust = Date.now();
    const url = `${KICK_LEGACY_API_V2_BASE}/channels/${slug}/videos?cursor=${cursor}&limit=${limit}&sort=${sortParam}&_=${cacheBust}`;

    // Without this, hung connections wait ~21s for Chromium's TCP timeout
    // before surfacing as ERR_CONNECTION_TIMED_OUT, blocking the Videos tab.
    // cache:'no-store' is required because Kick keeps returning a stale
    // snapshot of the just-ended stream's VOD (is_live=true, duration=0,
    // partial view count) for minutes after the stream actually finalises;
    // a clean-context fetch returns the finalised record immediately.
    // Kick's CDN (Cloudflare) caches the videos list and returns a snapshot
    // that omits the in-progress LIVE recording and shows stale duration/
    // view counts for the just-ended VOD. `cache: 'no-store'` and `?_=ts`
    // alone don't bust it because CF can ignore unknown query params for
    // cache keys. Sending request-side `Cache-Control: no-cache` forces a
    // revalidation hop to origin so we get the current list (including the
    // LIVE-badged first card) on every refetch.
    // Kick's CDN serves a smaller, cached snapshot to bare main-process
    // net.fetch requests: it omits the in-progress LIVE recording entirely
    // and returns the previous (finalised) VOD with stale duration / view
    // counts. The combination below — `cache:'no-store'`, request-side
    // `Cache-Control: no-cache`, the `?_=ts` buster, and a renderer-style
    // header set (sec-fetch-*, Origin, Accept-Language) — makes the request
    // look enough like the kick.com SPA's own XHR that the CDN returns the
    // current list including the LIVE-badged first card.
    const response = await net.fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        Origin: "https://kick.com",
        Referer: "https://kick.com/",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 404) {
      return { data: [] };
    }
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }
    const data = await response.json();

    let videos: any[] = [];
    let nextCursor: string | undefined;

    if (Array.isArray(data)) {
      videos = data;
      // V2 endpoint returns a raw array — advance offset whenever we got any
      // videos. Kick caps responses below the requested `limit` (cf. clip
      // endpoint), so a "full page" check would prematurely end pagination.
      // The next call returning an empty array is our real end-of-stream
      // signal; the UI de-dupes and detects stuck cursors.
      nextCursor =
        videos.length > 0
          ? (parseInt(cursor.toString(), 10) + videos.length).toString()
          : undefined;
    } else {
      videos = data.videos || [];
      // Wrapped response — trust Kick's own nextCursor as the source of truth.
      nextCursor = data.nextCursor ?? undefined;
    }

    return {
      data: videos
        // Drop unplayable records: streamer-deleted (deleted_at), platform-pruned
        // (is_pruned — Kick purges old VOD media but the API record persists), and
        // private (is_private). These return thumbnail 403s from images.kick.com
        // and would render as broken cards. Sub-only VODs are NOT filtered here —
        // they keep is_pruned=false/is_private=false; they're identified later via
        // the !source heuristic and rendered with a sub-only badge.
        .filter(
          (v: any) =>
            !v.deleted_at && !v.video?.deleted_at && !v.video?.is_pruned && !v.video?.is_private
        )
        .map((v: any) => {
          // A VOD without a source URL is subscriber-only content
          const hasSource = Boolean(v.source);
          const isSubOnly = !hasSource && !v.is_live;
          const sourceCreatedAt = normalizeKickDate(v.start_time || v.created_at) || undefined;

          return {
            id: v.id.toString(),
            uuid: v.uuid || v.video?.uuid || "", // UUID needed for api/v1/video/{uuid} endpoint
            slug: v.slug || "", // Video slug for URL construction
            title: v.session_title || v.title || `Stream ${v.id}`,
            duration: v.duration ? formatDuration(v.duration) : "0:00",
            sourceDurationMs: typeof v.duration === "number" ? v.duration : undefined,
            views: (v.views || v.view_count || "0").toString(),
            date: sourceCreatedAt || new Date().toISOString(),
            created_at: sourceCreatedAt || new Date().toISOString(),
            // Unlike `date`/`created_at`, this never receives the UI's
            // current-time fallback. Channel last-live metadata may only use
            // a timestamp that was actually present in Kick's VOD response.
            sourceCreatedAt,
            sourceEndedAt: normalizeKickDate(v.ended_at) || undefined,
            thumbnailUrl:
              v.thumbnail?.src ||
              v.thumbnail?.url ||
              v.thumbnail_url ||
              v.thumb ||
              v.video?.thumb ||
              "",
            source: v.source || "", // Direct HLS m3u8 URL - this is the most reliable way to play VODs
            url: v.source || `https://kick.com/video/${v.slug}`,
            shareUrl: v.slug ? `https://kick.com/video/${v.slug}` : undefined,
            platform: "kick",
            isLive: v.is_live,
            isSubOnly, // Flag for subscriber-only VODs
            // Include channel info for metadata
            channelSlug: v.channel?.slug || v.livestream?.channel?.slug || "",
            channelName: v.channel?.user?.username || v.livestream?.channel?.user?.username || "",
            channelAvatar:
              v.channel?.user?.profile_pic || v.livestream?.channel?.user?.profile_pic || null,
            // Category info - check multiple possible locations
            category:
              v.categories?.[0]?.name ||
              v.category?.name ||
              v.livestream?.categories?.[0]?.name ||
              v.livestream?.session_title ||
              "",
            // Language info
            language: v.language || v.livestream?.language || "",
          };
        }),
      cursor: nextCursor,
    };
  } catch (error) {
    logger.warn("Kick:Endpoints:Video", "Failed to fetch videos", {
      slug,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return { data: [] };
  }
}

/**
 * Find the newest trustworthy stream end among completed Kick VODs.
 *
 * Prefer Kick's explicit `ended_at` when present. Otherwise, derive the end
 * from the provider start timestamp plus duration only when Kick marks the VOD
 * offline and both inputs are valid. `updated_at` is intentionally not an end-time source.
 */
export async function getLatestCompletedVideoEndedAtByChannelSlug(
  slug: string
): Promise<string | undefined> {
  const videos = await getVideosByChannelSlug(slug, { limit: 20, sort: "date" });
  let latest: { value: string; time: number } | undefined;

  for (const video of videos.data || []) {
    if (video.isLive === true) continue;

    const explicitEndTime = Date.parse(video.sourceEndedAt ?? "");
    let time: number;
    let value: string;

    if (Number.isFinite(explicitEndTime)) {
      time = explicitEndTime;
      value = video.sourceEndedAt;
    } else {
      if (
        video.isLive !== false ||
        !Number.isFinite(video.sourceDurationMs) ||
        video.sourceDurationMs <= 0
      ) {
        continue;
      }

      const startedAt = Date.parse(video.sourceCreatedAt ?? "");
      time = startedAt + video.sourceDurationMs;
      if (!Number.isFinite(time)) continue;
      value = new Date(time).toISOString();
    }

    if (!latest || time > latest.time) {
      latest = { value, time };
    }
  }

  return latest?.value;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const formattedSecs = s.toString().padStart(2, "0");

  if (h > 0) {
    const formattedMins = m.toString().padStart(2, "0");
    return `${h}:${formattedMins}:${formattedSecs}`;
  }
  return `${m}:${formattedSecs}`;
}
