import { logger } from "@/backend/logging/logger";
import { sleep } from "@/lib/sleep";
import type { StreamPlayback } from "../../../../components/player/types";
import { KICK_LEGACY_API_V1_BASE } from "./kick-types";

const KICK_API_REQUEST_TIMEOUT_MS = 5000;
const PLAYBACK_URL_VALIDATION_TIMEOUT_MS = 1500;

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

    try {
      const res: Response = await net.fetch(url, {
        method: "GET", // IVS doesn't support HEAD, use GET with Range
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Origin: "https://kick.com",
          Referer: "https://kick.com/",
          // Only fetch first 1KB to minimize bandwidth
          Range: "bytes=0-1024",
        },
        signal: AbortSignal.timeout(PLAYBACK_URL_VALIDATION_TIMEOUT_MS),
      });

      // 200-299 or 206 (Partial Content) = valid; 404/403 = stream gone
      if (res.status === 404 || res.status === 403) {
        logger.debug("Kick:StreamResolver", "Playback URL validation failed", {
          status: res.status,
        });
        return false;
      }
      if (res.status >= 200 && res.status < 300) {
        return true;
      }
      // Other status codes (e.g., 503) - assume temporary, let player handle
      logger.debug(
        "Kick:StreamResolver",
        "Playback URL returned non-success status, assuming valid",
        {
          status: res.status,
        }
      );
      return true;
    } catch {
      // Timeout or network error — assume URL might be valid, let player handle
      return true;
    }
  }

  /**
   * Make a request using Electron's net module to bypass Cloudflare
   */
  private async netRequest<T>(url: string, context?: string): Promise<T> {
    const { net } = require("electron");

    // Without a timeout, the player hangs ~21s on Chromium's TCP timeout per
    // attempt; getStreamPlaybackUrl's 2-retry loop on top would mean ~42s
    // before the user sees an error.
    const res: Response = await net.fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://kick.com/",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(KICK_API_REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404) {
      const contextInfo = context ? ` for ${context}` : "";
      throw new Error(
        `Channel not found${contextInfo} - the channel may not exist or has been renamed`
      );
    }

    if (!res.ok) {
      throw new Error(`Kick API error: ${res.status}`);
    }

    try {
      return (await res.json()) as T;
    } catch (_e) {
      throw new Error("Failed to parse JSON");
    }
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
          logger.debug(
            "Kick:StreamResolver",
            "Playback URL returned 404 - stream likely just went offline"
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
          await sleep(500 * attempt);
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
      logger.error("Kick:StreamResolver", "Failed to resolve Kick VOD URL", {
        videoIdOrUuid,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
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
      logger.warn(
        "Kick:StreamResolver",
        "Could not fetch Kick video metadata; returning defaults",
        {
          videoId,
        }
      );
      // Return default metadata instead of throwing
      // The video can still play even without full metadata
      return defaultMetadata;
    }
  }
}
