import {
  KICK_LEGACY_API_V2_BASE,
  type KickLegacyApiClip,
  type PaginatedResult,
  type PaginationOptions,
} from "../kick-types";

/**
 * Get clips by channel slug using legacy API v2
 */
export async function getClipsByChannelSlug(
  slug: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<any>> {
  try {
    const { net } = require("electron");
    const limit = options.limit || 20;
    const cursor = options.cursor || 0; // V2 often uses cursor/offset
    // Map sort option: 'views' -> 'view', 'date' -> 'date' (Kick API uses 'view' not 'views')
    const sortParam = options.sort === "views" ? "view" : "date";

    const url = `${KICK_LEGACY_API_V2_BASE}/channels/${slug}/clips?cursor=${cursor}&limit=${limit}&sort=${sortParam}`;

    // Without this, hung connections wait ~21s for Chromium's TCP timeout
    // before surfacing as ERR_CONNECTION_TIMED_OUT, blocking the Clips tab.
    const response = await net.fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

    // Response shape: { clips: [...], nextCursor: ... }.
    // Trust Kick's nextCursor as the source of truth: Kick caps responses at
    // ~20 clips regardless of the requested `limit`, so `clips.length >= limit`
    // is an unreliable "end of stream" signal. If Kick returned a cursor,
    // there's more upstream.
    const clips = data.clips || [];
    const nextCursor = data.nextCursor ?? undefined;

    return {
      data: clips.map((c: KickLegacyApiClip) => ({
        id: c.id,
        title: c.title,
        duration: formatDuration(c.duration),
        views: c.views?.toString() || c.view_count?.toString() || "0",
        date: new Date(c.created_at).toLocaleDateString(),
        created_at: c.created_at, // Raw ISO date for time range filtering
        creatorName: c.creator?.username || c.creator?.slug || "",
        embedUrl: c.video_url, // Actual video file URL for playback
        url: c.clip_url, // Clip page URL on Kick website
        gameName: c.category?.name || "Unknown",
        isLive: false, // Clips aren't live
        thumbnailUrl: c.thumbnail_url,
        // VOD availability - livestream_id links to the full VOD
        vodId: c.livestream_id || "",
        // Channel info for VOD lookup
        channelSlug: c.channel?.slug || "",
      })),
      cursor: nextCursor?.toString(),
    };
  } catch (_error) {
    // console.warn(`Failed to fetch clips for ${slug}:`, error);
    // Suppress initial errors if API differs, try v1 if needed?
    // But for now assume v2 works as per observations.
    return { data: [] };
  }
}

function formatDuration(seconds: number): string {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
