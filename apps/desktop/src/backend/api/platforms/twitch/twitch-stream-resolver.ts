/**
 * Twitch Stream Resolver
 *
 * Resolves stream/VOD/clip playback URLs using the GQL API.
 * No API key required — uses the public GQL client.
 */

import * as GqlClient from "./twitch-gql-client";

export class TwitchStreamResolver {
  /**
   * Get playback URL for a live stream
   * First checks if the channel is actually live to avoid 404 errors
   */
  async getStreamPlaybackUrl(
    channelLogin: string
  ): Promise<{ url: string; format: string; qualities?: any[] }> {
    try {
      // Check if the channel is live using GQL (no API key needed)
      const isLive = await GqlClient.gqlIsChannelLive(channelLogin);
      if (!isLive) {
        throw new Error("Channel is offline");
      }

      const token = await GqlClient.gqlGetPlaybackAccessToken(channelLogin);
      const url = this.constructHlsUrl(channelLogin, token.value, token.signature);
      return {
        url,
        format: "hls",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.toLowerCase().includes("offline")) {
        console.error("Failed to resolve Twitch stream URL for:", channelLogin, error);
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
      console.error("Failed to resolve Twitch VOD URL for:", vodId, error);
      throw error;
    }
  }

  /**
   * Get playback URL for a clip using GQL API
   */
  async getClipPlaybackUrl(
    clipSlug: string
  ): Promise<{ url: string; format: string; qualities?: any[] }> {
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
      const finalUrl = `${bestQuality.sourceURL}?sig=${clipData.signature}&token=${encodeURIComponent(clipData.value)}`;

      const mappedQualities = sortedQualities.map((q) => ({
        quality: `${q.quality}p`,
        url: `${q.sourceURL}?sig=${clipData.signature}&token=${encodeURIComponent(clipData.value)}`,
        frameRate: q.frameRate,
      }));

      return {
        url: finalUrl,
        format: "mp4",
        qualities: mappedQualities,
      };
    } catch (error) {
      console.error("Failed to get clip playback URL:", clipSlug, error);
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
