import type { StreamPlayback } from "../../../../components/player/types";

import { KICK_LEGACY_API_V1_BASE } from "./kick-types";

export class KickStreamResolver {
  /**
   * Validate that a playback URL is actually accessible
   * Returns true if the URL is valid, false if it returns 404/403
   * This prevents returning stale URLs from Kick's API cache
   *
   * NOTE: We use GET with Range header instead of HEAD because
   * Amazon IVS (Kick's CDN) doesn't support HEAD requests for HLS manifests
   */
  private async validatePlaybackUrl(url: string): Promise<boolean> {
    const { net } = require("electron");

    return new Promise<boolean>((resolve) => {
      const request = net.request({
        method: "GET", // IVS doesn't support HEAD, use GET with Range
        url: url,
      });

      request.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      request.setHeader("Origin", "https://kick.com");
      request.setHeader("Referer", "https://kick.com/");
      // Only fetch first 1KB to minimize bandwidth
      request.setHeader("Range", "bytes=0-1024");

      // Set a short timeout for validation (5 seconds)
      const timeout = setTimeout(() => {
        request.abort();
        // On timeout, assume URL might be valid (don't block on slow CDN)
        resolve(true);
      }, 5000);

      request.on("response", (response: any) => {
        clearTimeout(timeout);
        // Abort the request immediately after getting status - we don't need the body
        request.abort();

        // 200-299 or 206 (Partial Content) = valid
        // 404/403 = stream gone
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(true);
        } else if (response.statusCode === 206) {
          // Partial Content - Range request successful
          resolve(true);
        } else if (response.statusCode === 404 || response.statusCode === 403) {
          console.debug(
            `[KickStreamResolver] Playback URL validation failed: ${response.statusCode}`
          );
          resolve(false);
        } else {
          // Other status codes (e.g., 503) - assume temporary, let player handle
          console.debug(
            `[KickStreamResolver] Playback URL returned status ${response.statusCode}, assuming valid`
          );
          resolve(true);
        }
      });

      request.on("error", () => {
        clearTimeout(timeout);
        // Network error - assume URL might be valid, let player handle
        resolve(true);
      });

      request.end();
    });
  }

  /**
   * Make a request using Electron's net module to bypass Cloudflare
   */
  private async netRequest<T>(url: string, context?: string): Promise<T> {
    const { net } = require("electron");

    return new Promise<T>((resolve, reject) => {
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

      // Without this, the player hangs ~21s on Chromium's TCP timeout per
      // attempt; getStreamPlaybackUrl's 2-retry loop on top would mean ~42s
      // before the user sees an error.
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
          const contextInfo = context ? ` for ${context}` : "";
          reject(
            new Error(
              `Channel not found${contextInfo} - the channel may not exist or has been renamed`
            )
          );
          return;
        }

        if (response.statusCode !== 200) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Kick API error: ${response.statusCode}`));
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
            resolve(JSON.parse(body) as T);
          } catch (_e) {
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
  }

  /**
   * Get playback URL for a Kick live stream
   * Uses the public v1 channel endpoint which typically includes the HLS playback URL
   *
   * IMPORTANT: We must verify the stream is actually LIVE before returning a URL.
   * Kick's API returns a playback_url even for offline channels, which causes 404 errors
   * when HLS.js tries to load the manifest.
   */
  async getStreamPlaybackUrl(channelSlug: string): Promise<StreamPlayback> {
    // Normalize slug to lowercase - Kick API is case-sensitive
    const normalizedSlug = channelSlug.toLowerCase();

    // Retry logic for transient failures
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const data = await this.netRequest<any>(
          `${KICK_LEGACY_API_V1_BASE}/channels/${normalizedSlug}`,
          normalizedSlug
        );

        // Verify the stream is actually live
        const isLive = data.livestream?.is_live === true;

        if (!isLive) {
          throw new Error("Channel is offline");
        }

        // The playback URL is usually in data.playback_url
        const playbackUrl = data.playback_url || data.livestream?.source || null;

        if (!playbackUrl) {
          throw new Error("No playback URL found in response");
        }

        // CRITICAL: Validate that the playback URL is actually accessible
        // Kick's API often returns stale playback_url for streams that just went offline
        // This preflight check prevents the "404 → refresh → same 404" loop
        const isUrlValid = await this.validatePlaybackUrl(playbackUrl);
        if (!isUrlValid) {
          console.debug(
            `[KickStreamResolver] Playback URL returned 404 - stream likely just went offline`
          );
          throw new Error("Channel is offline");
        }

        return {
          url: playbackUrl,
          format: "hls",
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry for expected errors
        if (
          lastError.message.toLowerCase().includes("offline") ||
          lastError.message.toLowerCase().includes("not found")
        ) {
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error("Failed to get stream playback URL");
  }

  /**
   * Get playback URL for a Kick VOD
   * The Kick api/v1/video/{video} endpoint expects a UUID, not a numeric ID.
   *
   * Supported input formats:
   * - UUID (e.g., "DsuAwCgUc9Bh") - used directly
   * - Numeric ID + slug (e.g., "86960612-stream-title") - extracts ID and looks up via slug
   * - Numeric ID only (e.g., "86960612") - looks up via video slug format
   * - Direct source URL (starts with http) - returns directly
   */
  async getVodPlaybackUrl(videoIdOrUuid: string): Promise<StreamPlayback> {
    try {
      // Case 1: If it's already a direct HLS URL, return it
      if (videoIdOrUuid.startsWith("http")) {
        return {
          url: videoIdOrUuid,
          format: "hls",
        };
      }

      // Case 2: If it contains a slash, it might be a UUID format used in HLS paths
      // or it could be a compound UUID like "DsuAwCgUc9Bh/3aT94dU19iXQ"
      // The api/v1/video endpoint typically uses the simple UUID part

      // Case 3: Try the video slug endpoint first
      // Video slugs look like: "86960612-stream-title" or just the numeric ID
      // However, the API expects the UUID, not the numeric ID

      // First, let's try different API approaches
      let data: any = null;
      let lastError: Error | null = null;

      // Try 1: Direct video lookup by ID/UUID (works if it's a proper UUID)
      try {
        data = await this.netRequest<any>(`${KICK_LEGACY_API_V1_BASE}/video/${videoIdOrUuid}`);
        if (data?.source) {
          return {
            url: data.source,
            format: "hls",
          };
        }
      } catch (e) {
        lastError = e as Error;
        // Continue to try other methods
      }

      // Try 2: For numeric IDs, try looking up via a video slug with numeric ID pattern
      // Some video slugs are in format: "86960612-stream-title-here"
      // Try accessing the video info through another endpoint
      if (/^\d+$/.test(videoIdOrUuid) || /^\d+-/.test(videoIdOrUuid)) {
        // Extract just the numeric ID if it has a slug attached
        const numericId = videoIdOrUuid.split("-")[0];

        // Try the video endpoint with just the numeric part
        // Note: This may still fail as the API expects UUID
        try {
          data = await this.netRequest<any>(`${KICK_LEGACY_API_V1_BASE}/video/${numericId}`);
          if (data?.source) {
            return {
              url: data.source,
              format: "hls",
            };
          }
        } catch (e) {
          // Continue - the API might not support numeric IDs
          lastError = e as Error;
        }
      }

      // If all attempts failed, throw the last error with helpful message
      throw new Error(
        `Could not resolve VOD playback URL for "${videoIdOrUuid}". ` +
          `The Kick API requires a video UUID, but this appears to be a numeric ID. ` +
          `To play Kick VODs, use the source URL directly from the video list. ` +
          `Original error: ${lastError?.message || "Unknown error"}`
      );
    } catch (error) {
      console.error("Failed to resolve Kick VOD URL for:", videoIdOrUuid, error);
      throw error;
    }
  }

  /**
   * Get video metadata for a Kick VOD
   * Note: The api/v1/video/{video} endpoint expects a UUID, not a numeric ID.
   * If the lookup fails, we return partial metadata with the ID.
   */
  async getVideoMetadata(videoId: string): Promise<{
    id: string;
    title: string;
    channelId: string;
    channelName: string;
    channelDisplayName: string;
    channelAvatar: string | null;
    views: number;
    duration: string;
    createdAt: string;
    thumbnailUrl: string;
    platform: string;
    category?: string;
  }> {
    // Format duration from milliseconds to readable format
    const formatDuration = (ms: number): string => {
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
    };

    // Default metadata when lookup fails
    const defaultMetadata = {
      id: videoId,
      title: "Kick VOD",
      channelId: "",
      channelName: "",
      channelDisplayName: "Kick Channel",
      channelAvatar: null,
      views: 0,
      duration: "0:00",
      createdAt: new Date().toISOString(),
      thumbnailUrl: "",
      platform: "kick",
      category: undefined,
    };

    try {
      // Try to fetch metadata - this may fail for numeric IDs
      const data = await this.netRequest<any>(`${KICK_LEGACY_API_V1_BASE}/video/${videoId}`);

      return {
        id: data.id?.toString() || videoId,
        title: data.session_title || data.title || `Stream VOD`,
        channelId: data.channel?.id?.toString() || data.livestream?.channel?.id?.toString() || "",
        channelName: data.channel?.slug || data.livestream?.channel?.slug || "",
        channelDisplayName:
          data.channel?.user?.username ||
          data.livestream?.channel?.user?.username ||
          data.channel?.slug ||
          "",
        channelAvatar:
          data.channel?.user?.profile_pic || data.livestream?.channel?.user?.profile_pic || null,
        views: data.views || data.view_count || 0,
        duration: formatDuration(data.duration || 0),
        createdAt: data.created_at || new Date().toISOString(),
        thumbnailUrl: data.thumbnail?.src || data.thumbnail?.url || data.thumbnail_url || "",
        platform: "kick",
        category:
          data.categories?.[0]?.name ||
          data.category?.name ||
          data.livestream?.categories?.[0]?.name ||
          undefined,
      };
    } catch (_error) {
      console.warn(
        "Could not fetch Kick video metadata for:",
        videoId,
        "- returning default metadata"
      );
      // Return default metadata instead of throwing
      // The video can still play even without full metadata
      return defaultMetadata;
    }
  }
}
