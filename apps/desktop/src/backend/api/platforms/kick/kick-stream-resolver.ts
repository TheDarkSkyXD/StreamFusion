import { logger } from "@backend/logging/logger";
import { sleep } from "@shared/utils/sleep";
import type { StreamPlayback } from "../../../../frontend/features/playback/components/player/types";
import {
  getCachedKickLivePlayback,
  rememberKickLivePlaybackFromChannelPayload,
} from "./kick-playback-cache";
import { KICK_LEGACY_API_V1_BASE } from "./kick-types";

const KICK_API_REQUEST_TIMEOUT_MS = 5000;

function getUrlHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

interface KickChannelPlayback {
  playback_url?: string;
  livestream?: { is_live?: boolean; source?: string } | null;
}

function isKickChannelPlayback(value: unknown): value is KickChannelPlayback {
  if (typeof value !== "object" || value === null) return false;
  if (
    "playback_url" in value &&
    value.playback_url !== undefined &&
    typeof value.playback_url !== "string"
  )
    return false;
  if (!("livestream" in value) || value.livestream === undefined || value.livestream === null)
    return true;
  return typeof value.livestream === "object";
}

interface KickVideoPayload {
  id?: string | number;
  source?: string;
  session_title?: string;
  title?: string;
  channel?: {
    id?: string | number;
    slug?: string;
    user?: { username?: string; profile_pic?: string };
  };
  livestream?: {
    channel?: {
      id?: string | number;
      slug?: string;
      user?: { username?: string; profile_pic?: string };
    };
    categories?: Array<{ name?: string }>;
  };
  views?: number;
  view_count?: number;
  duration?: number;
  created_at?: string;
  thumbnail?: { src?: string; url?: string };
  thumbnail_url?: string;
  categories?: Array<{ name?: string }>;
  category?: { name?: string };
}

function isKickVideoPayload(value: unknown): value is KickVideoPayload {
  if (typeof value !== "object" || value === null) return false;
  if ("source" in value && value.source !== undefined && typeof value.source !== "string")
    return false;
  if ("duration" in value && value.duration !== undefined && typeof value.duration !== "number")
    return false;
  return true;
}

function isHandledKickVodUnavailableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("could not resolve vod playback url") ||
    message.includes("kick api error: 400") ||
    message.includes("channel not found") ||
    message.includes("not found")
  );
}

export class KickStreamResolver {
  /**
   * Make a request using Electron's net module to bypass Cloudflare
   */
  private async netRequest(url: string, context?: string): Promise<unknown> {
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
      return await res.json();
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
  async getStreamPlaybackUrl(
    channelSlug: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<StreamPlayback> {
    // Normalize slug to lowercase - Kick API is case-sensitive
    const normalizedSlug = channelSlug.toLowerCase();
    const startedAt = Date.now();

    const cachedPlayback = options.forceRefresh ? null : getCachedKickLivePlayback(normalizedSlug);
    if (cachedPlayback) {
      logger.info("Kick:StreamResolver", "resolved live playback URL", {
        channelSlug: normalizedSlug,
        attempt: 0,
        requestDurationMs: 0,
        totalDurationMs: Date.now() - startedAt,
        cacheSource: "memory",
        cacheAgeMs: cachedPlayback.ageMs,
        urlHost: getUrlHost(cachedPlayback.url),
        sourceField: cachedPlayback.sourceField,
      });
      return {
        url: cachedPlayback.url,
        format: cachedPlayback.format,
      };
    }

    // Retry logic for transient failures
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const attemptStartedAt = Date.now();
        const data = await this.netRequest(
          `${KICK_LEGACY_API_V1_BASE}/channels/${normalizedSlug}`,
          normalizedSlug
        );
        const requestDurationMs = Date.now() - attemptStartedAt;

        if (!isKickChannelPlayback(data)) throw new Error("Invalid channel playback response");
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

        rememberKickLivePlaybackFromChannelPayload(normalizedSlug, data);

        logger.info("Kick:StreamResolver", "resolved live playback URL", {
          channelSlug: normalizedSlug,
          attempt,
          requestDurationMs,
          totalDurationMs: Date.now() - startedAt,
          cacheSource: "network",
          urlHost: getUrlHost(playbackUrl),
          sourceField: data.playback_url ? "playback_url" : "livestream.source",
        });

        return {
          url: playbackUrl,
          format: "hls",
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const totalDurationMs = Date.now() - startedAt;

        // Don't retry for expected errors
        if (
          lastError.message.toLowerCase().includes("offline") ||
          lastError.message.toLowerCase().includes("not found")
        ) {
          logger.info("Kick:StreamResolver", "live playback unavailable", {
            channelSlug: normalizedSlug,
            attempt,
            totalDurationMs,
            reason: lastError.message,
          });
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          logger.debug("Kick:StreamResolver", "live playback attempt failed; retrying", {
            channelSlug: normalizedSlug,
            attempt,
            totalDurationMs,
            error: lastError.message,
          });
          await sleep(500 * attempt);
        }
      }
    }

    // All retries exhausted
    logger.warn("Kick:StreamResolver", "failed to resolve live playback URL", {
      channelSlug: normalizedSlug,
      attempts: maxRetries,
      totalDurationMs: Date.now() - startedAt,
      error: lastError?.message ?? "Unknown error",
    });
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
      let data: unknown = null;
      let lastError: Error | null = null;

      // Try 1: Direct video lookup by ID/UUID (works if it's a proper UUID)
      try {
        data = await this.netRequest(`${KICK_LEGACY_API_V1_BASE}/video/${videoIdOrUuid}`);
        if (isKickVideoPayload(data) && data.source) {
          return {
            url: data.source,
            format: "hls",
          };
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
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
          data = await this.netRequest(`${KICK_LEGACY_API_V1_BASE}/video/${numericId}`);
          if (isKickVideoPayload(data) && data.source) {
            return {
              url: data.source,
              format: "hls",
            };
          }
        } catch (e) {
          // Continue - the API might not support numeric IDs
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      }

      // If all attempts failed, throw the last error with helpful message
      const identifierHint =
        /^\d+$/.test(videoIdOrUuid) || /^\d+-/.test(videoIdOrUuid)
          ? "The Kick API requires a video UUID, but this appears to be a numeric ID. "
          : "Kick could not resolve this video identifier through its public VOD endpoint. ";
      throw new Error(
        `Could not resolve VOD playback URL for "${videoIdOrUuid}". ` +
          identifierHint +
          `To play Kick VODs, use the source URL directly from the video list. ` +
          `Original error: ${lastError?.message || "Unknown error"}`
      );
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      if (isHandledKickVodUnavailableError(resolvedError)) {
        logger.warn("Kick:StreamResolver", "Kick VOD unavailable", {
          videoIdOrUuid,
          reason: resolvedError.message,
        });
      } else {
        logger.error("Kick:StreamResolver", "Failed to resolve Kick VOD URL", {
          videoIdOrUuid,
          error: {
            name: resolvedError.name,
            message: resolvedError.message,
            stack: resolvedError.stack,
          },
        });
      }
      throw resolvedError;
    }
  }

  /**
   * Get video metadata for a Kick VOD
   * Note: The api/v1/video/{video} endpoint expects a UUID, not a numeric ID.
   * If the lookup fails, return null so callers can surface an explicit
   * unavailable state instead of fabricating presentation data.
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
  } | null> {
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

    try {
      // Try to fetch metadata - this may fail for numeric IDs
      const data = await this.netRequest(`${KICK_LEGACY_API_V1_BASE}/video/${videoId}`);
      if (!isKickVideoPayload(data)) return null;

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
      logger.warn("Kick:StreamResolver", "Could not fetch Kick video metadata", {
        videoId,
      });
      return null;
    }
  }
}
