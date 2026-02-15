import { ipcMain } from "electron";

import type { Platform } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { storageService } from "../../services/storage-service";

export function registerStreamHandlers(): void {
  /**
   * Get top streams from one or both platforms
   */
  ipcMain.handle(
    IPC_CHANNELS.STREAMS_GET_TOP,
    async (
      _event,
      params: {
        platform?: Platform;
        categoryId?: string;
        language?: string;
        limit?: number;
        cursor?: string;
      } = {}
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        const results: { platform: Platform; data: any[]; cursor?: string }[] = [];

        // Fetch from Twitch if no platform specified or platform is twitch
        if (!params.platform || params.platform === "twitch") {
          try {
            const twitchResult = await twitchClient.getTopStreams({
              first: params.limit || 20,
              after: params.cursor,
              gameId: params.categoryId,
              language: params.language,
            });
            results.push({
              platform: "twitch",
              data: twitchResult.data,
              cursor: twitchResult.cursor,
            });
          } catch (err) {
            console.warn("⚠️ Failed to fetch Twitch top streams:", err);
          }
        }

        // Fetch from Kick if no platform specified or platform is kick
        if (!params.platform || params.platform === "kick") {
          try {
            const kickResult = await kickClient.getTopStreams({
              limit: params.limit || 20,
              categoryId: params.categoryId,
              language: params.language,
            });
            results.push({
              platform: "kick",
              data: kickResult.data,
              cursor: kickResult.nextPage?.toString(),
            });
          } catch (err) {
            console.warn("⚠️ Failed to fetch Kick top streams:", err);
          }
        }

        // Merge and sort by viewer count if fetching from both platforms
        if (!params.platform) {
          const allStreams = results.flatMap((r) => r.data);
          allStreams.sort((a, b) => b.viewerCount - a.viewerCount);
          return { success: true, data: allStreams };
        }

        return { success: true, ...results[0] };
      } catch (error) {
        console.error("❌ Failed to get top streams:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch streams",
        };
      }
    }
  );

  /**
   * Get streams by category
   */
  ipcMain.handle(
    IPC_CHANNELS.STREAMS_GET_BY_CATEGORY,
    async (
      _event,
      params: {
        categoryId: string;
        platform?: Platform;
        limit?: number;
        cursor?: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        const results: { platform: Platform; data: any[]; cursor?: string }[] = [];

        if (!params.platform || params.platform === "twitch") {
          try {
            const result = await twitchClient.getTopStreams({
              first: params.limit || 20,
              after: params.cursor,
              gameId: params.categoryId,
            });
            results.push({ platform: "twitch", data: result.data, cursor: result.cursor });
          } catch (err) {
            console.warn("⚠️ Failed to fetch Twitch streams by category:", err);
          }
        }

        if (!params.platform || params.platform === "kick") {
          try {
            const result = await kickClient.getStreamsByCategory(params.categoryId, {
              limit: params.limit || 20,
            });
            results.push({
              platform: "kick",
              data: result.data,
              cursor: result.nextPage?.toString(),
            });
          } catch (err) {
            console.warn("⚠️ Failed to fetch Kick streams by category:", err);
          }
        }

        if (!params.platform) {
          const allStreams = results.flatMap((r) => r.data);
          allStreams.sort((a, b) => b.viewerCount - a.viewerCount);
          return { success: true, data: allStreams };
        }

        return { success: true, ...results[0] };
      } catch (error) {
        console.error("❌ Failed to get streams by category:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch streams",
        };
      }
    }
  );

  /**
   * Get followed streams (requires authentication OR local follows)
   */
  ipcMain.handle(
    IPC_CHANNELS.STREAMS_GET_FOLLOWED,
    async (
      _event,
      params: {
        platform?: Platform;
        limit?: number;
        cursor?: string;
      } = {}
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        const results: { platform: Platform; data: any[]; cursor?: string }[] = [];

        // Twitch
        if (!params.platform || params.platform === "twitch") {
          const localTwitch = storageService.getActiveFollowsByPlatform("twitch");
          const twitchStreams: any[] = [];
          const seenIds = new Set<string>();

          // 1. Remote (User Authenticated)
          if (twitchClient.isAuthenticated()) {
            try {
              const result = await twitchClient.getFollowedStreams({
                first: params.limit || 100,
                after: params.cursor,
              });
              result.data.forEach((s) => {
                if (!seenIds.has(s.id)) {
                  twitchStreams.push(s);
                  seenIds.add(s.id);
                }
              });
              results.push({ platform: "twitch", data: twitchStreams, cursor: result.cursor });
            } catch (err) {
              console.warn("⚠️ Failed to fetch Twitch remote followed streams:", err);
            }
          }

          // 2. Local Follows (GQL - no auth needed, works for guests)
          if (localTwitch.length > 0) {
            try {
              // Use channel logins (not IDs) so GQL can handle this without auth
              const loginsToFetch = [...new Set(localTwitch.map((f) => f.channelName))];

              if (loginsToFetch.length > 0) {
                try {
                  const localStreamsResult = await twitchClient.getStreamsByLogins(loginsToFetch);
                  localStreamsResult.data.forEach((s) => {
                    if (!seenIds.has(s.id)) {
                      twitchStreams.push(s);
                      seenIds.add(s.id);
                    }
                  });
                } catch (e) {
                  console.warn("Failed to fetch local twitch streams via GQL", e);
                }

                const existingTwitch = results.find((r) => r.platform === "twitch");
                if (existingTwitch) {
                  existingTwitch.data = twitchStreams;
                } else if (twitchStreams.length > 0) {
                  results.push({ platform: "twitch", data: twitchStreams });
                }
              }
            } catch (err) {
              console.warn("⚠️ Failed to fetch Twitch local followed streams:", err);
            }
          }
        }

        // Kick
        if (!params.platform || params.platform === "kick") {
          const localKick = storageService.getActiveFollowsByPlatform("kick");
          const kickStreams: any[] = [];
          const seenIds = new Set<string>();

          // 1. Remote (User Authenticated)
          if (kickClient.isAuthenticated()) {
            try {
              const result = await kickClient.getFollowedStreams({
                limit: params.limit || 100,
              });
              result.data.forEach((s) => {
                if (!seenIds.has(s.id)) {
                  kickStreams.push(s);
                  seenIds.add(s.id);
                }
              });
            } catch (err) {
              console.warn("⚠️ Failed to fetch Kick remote followed streams:", err);
            }
          }

          // 2. Local Follows (Guest/Public)
          if (localKick.length > 0) {
            const uniqueSlugs = [...new Set(localKick.map((f) => f.channelName))];

            // Throttle requests to avoid 429 (Kick API is sensitive to parallel bursts)
            // We process in small chunks with delays
            const localResults: any[] = [];
            const CHUNK_SIZE = 3;

            for (let i = 0; i < uniqueSlugs.length; i += CHUNK_SIZE) {
              const chunk = uniqueSlugs.slice(i, i + CHUNK_SIZE);
              // console.log(`[Kick] Fetching chunk ${i / CHUNK_SIZE + 1} of local follows...`);

              const chunkPromises = chunk.map((slug) => kickClient.getPublicStreamBySlug(slug));
              const chunkResults = await Promise.allSettled(chunkPromises);
              chunkResults.forEach((result) => {
                if (result.status === "fulfilled" && result.value) {
                  localResults.push(result.value);
                } else if (result.status === "rejected") {
                  console.warn("Failed to fetch Kick stream:", result.reason);
                }
              });

              // Delay between chunks if there are more
              if (i + CHUNK_SIZE < uniqueSlugs.length) {
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
            }

            localResults.forEach((s) => {
              if (s && !seenIds.has(s.id)) {
                kickStreams.push(s);
                seenIds.add(s.id);
              }
            });
          }

          results.push({ platform: "kick", data: kickStreams });
        }

        if (!params.platform) {
          const allStreams = results.flatMap((r) => r.data);
          allStreams.sort((a, b) => b.viewerCount - a.viewerCount);
          return { success: true, data: allStreams };
        }

        return { success: true, ...(results[0] || { data: [] }) };
      } catch (error) {
        console.error("❌ Failed to get followed streams:", error);
        return {
          success: true,
          data: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  /**
   * Get stream by channel username/slug
   */
  ipcMain.handle(
    IPC_CHANNELS.STREAMS_GET_BY_CHANNEL,
    async (
      _event,
      params: {
        platform: Platform;
        username: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        let stream = null;

        if (params.platform === "twitch") {
          stream = await twitchClient.getStreamByLogin(params.username);
        } else if (params.platform === "kick") {
          stream = await kickClient.getStreamBySlug(params.username);
        }

        return { success: true, data: stream };
      } catch (error) {
        console.error("❌ Failed to get stream by channel:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch stream",
        };
      }
    }
  );

  /**
   * Get playback URL for a live stream
   * Ad-blocking is handled client-side via VAFT in the HLS player
   */
  ipcMain.handle(
    IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL,
    async (
      _event,
      params: {
        platform: Platform;
        channelSlug: string;
      }
    ) => {
      const { TwitchStreamResolver } = await import(
        "../../api/platforms/twitch/twitch-stream-resolver"
      );
      const { KickStreamResolver } = await import("../../api/platforms/kick/kick-stream-resolver");

      const twitchResolver = new TwitchStreamResolver();
      const kickResolver = new KickStreamResolver();

      try {
        if (params.platform === "twitch") {
          const result = await twitchResolver.getStreamPlaybackUrl(params.channelSlug);
          return { success: true, data: result };
        } else if (params.platform === "kick") {
          const result = await kickResolver.getStreamPlaybackUrl(params.channelSlug);
          return { success: true, data: result };
        }
        throw new Error(`Unsupported platform: ${params.platform}`);
      } catch (error) {
        // "Channel is offline" is expected behavior - don't log as error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.toLowerCase().includes("offline")) {
          console.error("❌ Failed to get stream playback URL:", error);
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to resolve stream URL",
        };
      }
    }
  );
}
