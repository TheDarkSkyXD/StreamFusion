import {
  KICK_LEGACY_API_V2_BASE,
  type KickLegacyApiClip,
  type PaginationOptions,
} from "../kick-types";

async function fetchLegacyClipPage(url: string): Promise<{
  clips: KickLegacyApiClip[];
  cursor?: string;
}> {
  const { net } = require("electron");
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

  if (response.status === 404) return { clips: [] };
  if (!response.ok) throw new Error(`Status ${response.status}`);

  const data = await response.json();
  return {
    clips: data.clips || [],
    cursor: data.nextCursor?.toString(),
  };
}

/**
 * Get clips by channel slug using legacy API v2
 */
export async function getClipsByChannelSlug(slug: string, options: PaginationOptions = {}) {
  try {
    const limit = options.limit || 20;
    const cursor = options.cursor || 0; // V2 often uses cursor/offset
    // Map sort option: 'views' -> 'view', 'date' -> 'date' (Kick API uses 'view' not 'views')
    const sortParam = options.sort === "views" ? "view" : "date";

    const url = `${KICK_LEGACY_API_V2_BASE}/channels/${slug}/clips?cursor=${cursor}&limit=${limit}&sort=${sortParam}`;

    // Response shape: { clips: [...], nextCursor: ... }.
    // Trust Kick's nextCursor as the source of truth: Kick caps responses at
    // ~20 clips regardless of the requested `limit`, so `clips.length >= limit`
    // is an unreliable "end of stream" signal. If Kick returned a cursor,
    // there's more upstream.
    const { clips, cursor: nextCursor } = await fetchLegacyClipPage(url);
    const publicChannelPath = encodeURIComponent(slug);

    return {
      data: clips.map((c: KickLegacyApiClip) => {
        const publicClipUrl = `https://kick.com/${publicChannelPath}/clips/${encodeURIComponent(c.id)}`;
        return {
          id: c.id,
          title: c.title,
          duration: formatDuration(c.duration),
          views: c.views?.toString() || c.view_count?.toString() || "0",
          date: new Date(c.created_at).toLocaleDateString(),
          created_at: c.created_at, // Raw ISO date for time range filtering
          creatorName: c.creator?.username || c.creator?.slug || "",
          embedUrl: c.video_url, // Actual video file URL for playback
          url: publicClipUrl,
          shareUrl: publicClipUrl,
          gameName: c.category?.name || "Unknown",
          isLive: false, // Clips aren't live
          thumbnailUrl: c.thumbnail_url,
          // VOD availability - livestream_id links to the full VOD
          vodId: c.livestream_id || "",
          // Channel info for VOD lookup
          channelSlug: c.channel?.slug || "",
        };
      }),
      cursor: nextCursor,
    };
  } catch (_error) {
    // console.warn(`Failed to fetch clips for ${slug}:`, error);
    // Suppress initial errors if API differs, try v1 if needed?
    // But for now assume v2 works as per observations.
    return { data: [] };
  }
}

/** Get clips from Kick's legacy native Category feed. */
export async function getClipsByCategorySlug(
  categorySlug: string,
  options: PaginationOptions = {}
) {
  const limit = options.limit || 20;
  const cursor = options.cursor || 0;
  const sortParam = options.sort === "views" ? "view" : "date";
  const timeParam = options.timeRange || "all";
  const url = `${KICK_LEGACY_API_V2_BASE}/categories/${encodeURIComponent(categorySlug)}/clips?cursor=${encodeURIComponent(String(cursor))}&limit=${limit}&sort=${sortParam}&time=${timeParam}`;
  const page = await fetchLegacyClipPage(url);

  return {
    data: page.clips.map((clip: KickLegacyApiClip) => {
      const channelSlug = clip.channel?.slug || "";
      const publicClipUrl = `https://kick.com/${encodeURIComponent(channelSlug)}/clips/${encodeURIComponent(clip.id)}`;

      return {
        id: clip.id,
        title: clip.title,
        duration: formatDuration(clip.duration),
        views: clip.views?.toString() || clip.view_count?.toString() || "0",
        date: new Date(clip.created_at).toLocaleDateString(),
        created_at: clip.created_at,
        creatorName: clip.creator?.username || clip.creator?.slug || "",
        embedUrl: clip.video_url,
        url: publicClipUrl,
        shareUrl: publicClipUrl,
        gameId: clip.category?.id?.toString() || "",
        gameName: clip.category?.name || "Unknown",
        category: clip.category?.name || "Unknown",
        thumbnailUrl: clip.thumbnail_url,
        vodId: clip.livestream_id || "",
        channelId: clip.channel_id?.toString() || clip.channel?.id?.toString() || "",
        channelName: channelSlug,
        channelDisplayName: clip.channel?.username || channelSlug,
        channelAvatar:
          clip.channel?.profile_pic ||
          clip.channel?.profile_picture ||
          clip.channel?.avatar_url ||
          clip.channel?.user?.profile_pic ||
          clip.channel?.user?.profile_picture ||
          "",
        platform: "kick" as const,
      };
    }),
    cursor: page.cursor,
  };
}

function formatDuration(seconds: number): string {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
