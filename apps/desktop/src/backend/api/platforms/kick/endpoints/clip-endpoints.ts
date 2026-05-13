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

    const data = await new Promise<any>((resolve, reject) => {
      const request = net.request({
        method: "GET",
        url: url,
      });

      request.setHeader("Accept", "application/json");
      request.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      request.setHeader("Referer", "https://kick.com/");
      request.setHeader("X-Requested-With", "XMLHttpRequest");

      // Without this, hung connections wait ~21s for Chromium's TCP timeout
      // before surfacing as ERR_CONNECTION_TIMED_OUT, blocking the Clips tab.
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        request.abort();
        reject(new Error("Request timeout"));
      }, 5000);

      request.on("response", (response: any) => {
        if (response.statusCode === 404) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({ clips: [] });
          return;
        }

        if (response.statusCode !== 200) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Status ${response.statusCode}`));
          return;
        }

        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });

        response.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(body));
          } catch (_e) {
            console.warn(`[KickClip] Failed to parse JSON for ${slug}`);
            reject(new Error("Failed to parse JSON"));
          }
        });
      });

      request.on("error", (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });

      request.end();
    });

    // Response usually: { clips: [...], nextCursor: ... }
    const clips = data.clips || [];
    // Only return cursor if we got a full page (might be more data)
    // If we got fewer than requested, we've reached the end
    const nextCursor = clips.length >= limit && data.nextCursor ? data.nextCursor : undefined;

    return {
      data: clips.map((c: KickLegacyApiClip) => ({
        id: c.id,
        title: c.title,
        duration: formatDuration(c.duration),
        views: c.views?.toString() || c.view_count?.toString() || "0",
        date: new Date(c.created_at).toLocaleDateString(),
        created_at: c.created_at, // Raw ISO date for time range filtering
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
