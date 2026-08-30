/**
 * Twitch Stream Resolver
 *
 * Resolves stream/VOD/clip playback URLs using the GQL API.
 * No API key required — uses the public GQL client.
 */

import { logger } from "@shared/utils/cross-logger";
import { buildTwitchClipMediaUrl } from "../../../protocols/twitch-clip-media-url";
import * as GqlClient from "./twitch-gql-client";

export class TwitchStreamResolver {
  /**
   * Get playback URL for a live stream.
   *
   * Keep this path to one GQL round trip. The player watchdogs already handle
   * stale/offline manifests, and an extra live-status preflight directly slows
   * every successful stream open.
   */
  async getStreamPlaybackUrl(channelLogin: string): Promise<{
    url: string;
    format: string;
    qualities?: Array<{ quality: string; url: string; frameRate?: number }>;
  }> {
    const normalizedLogin = channelLogin.toLowerCase();
    const startedAt = Date.now();
    try {
      const tokenStartedAt = Date.now();
      const token = await GqlClient.gqlGetPlaybackAccessToken(normalizedLogin);
      const tokenDurationMs = Date.now() - tokenStartedAt;
      const url = this.constructHlsUrl(normalizedLogin, token.value, token.signature);
      logger.info("Twitch:StreamResolver", "resolved live playback URL", {
        channelLogin: normalizedLogin,
        tokenDurationMs,
        totalDurationMs: Date.now() - startedAt,
        urlHost: "usher.ttvnw.net",
      });
      return {
        url,
        format: "hls",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.toLowerCase().includes("offline")) {
        logger.info("Twitch:StreamResolver", "live playback unavailable", {
          channelLogin: normalizedLogin,
          totalDurationMs: Date.now() - startedAt,
          reason: errorMessage,
        });
      }
      if (!errorMessage.toLowerCase().includes("offline")) {
        logger.error("Twitch:StreamResolver", "Failed to resolve Twitch stream URL", {
          channelLogin: normalizedLogin,
          totalDurationMs: Date.now() - startedAt,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
      throw error;
    }
  }

  /**
   * Get playback URL for a VOD
   */
  async getVodPlaybackUrl(vodId: string): Promise<{ url: string; format: string }> {
    try {
      const token = await GqlClient.gqlGetVodAccessToken(vodId);
      const url = this.constructVodUrl(vodId, token.value, token.signature);
      return {
        url,
        format: "hls",
      };
    } catch (error) {
      logger.error("Twitch:StreamResolver", "Failed to resolve Twitch VOD URL", {
        vodId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Get playback URL for a clip using GQL API
   */
  async getClipPlaybackUrl(clipSlug: string): Promise<{
    url: string;
    format: string;
    qualities?: Array<{ quality: string; url: string; frameRate?: number }>;
  }> {
    try {
      const clipData = await GqlClient.gqlGetClipAccessToken(clipSlug);

      if (!clipData.qualities || clipData.qualities.length === 0) {
        throw new Error("No video qualities found for this clip");
      }

      // Sort by quality (descending) and pick the best
      const sortedQualities = [...clipData.qualities]
        .filter((q) => q.sourceURL) // Filter out empty sourceURLs
        .sort((a, b) => {
          const qualityA = parseInt(a.quality, 10) || 0;
          const qualityB = parseInt(b.quality, 10) || 0;
          return qualityB - qualityA;
        });

      if (sortedQualities.length === 0) {
        throw new Error("No valid video qualities found for this clip");
      }

      const bestQuality = sortedQualities[0];
      const buildSignedUrl = (sourceUrl: string) =>
        `${sourceUrl}?sig=${clipData.signature}&token=${encodeURIComponent(clipData.value)}`;
      const finalUrl = buildTwitchClipMediaUrl(buildSignedUrl(bestQuality.sourceURL));

      const mappedQualities = sortedQualities.map((q) => ({
        quality: `${q.quality}p`,
        url: buildTwitchClipMediaUrl(buildSignedUrl(q.sourceURL)),
        frameRate: q.frameRate,
      }));

      return {
        url: finalUrl,
        format: "mp4",
        qualities: mappedQualities,
      };
    } catch (error) {
      logger.error("Twitch:StreamResolver", "Failed to get clip playback URL", {
        clipSlug,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  private constructHlsUrl(channel: string, token: string, sig: string): string {
    const p = Math.floor(Math.random() * 999999);
    return `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?token=${encodeURIComponent(token)}&sig=${sig}&allow_source=true&allow_audio_only=true&p=${p}`;
  }

  private constructVodUrl(vodId: string, token: string, sig: string): string {
    const p = Math.floor(Math.random() * 999999);
    return `https://usher.ttvnw.net/vod/${vodId}.m3u8?token=${encodeURIComponent(token)}&sig=${sig}&allow_source=true&allow_audio_only=true&p=${p}`;
  }
}
