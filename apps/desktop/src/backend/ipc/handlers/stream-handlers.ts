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

        const fetchTwitch = async () => {
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
        };

        const fetchKick = async () => {
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
        };

        // Run both platform fetches in parallel when no filter is given.
        // Per-platform try/catch above means allSettled is never needed for error containment.
        if (!params.platform) {
          await Promise.all([fetchTwitch(), fetchKick()]);
        } else if (params.platform === "twitch") {
          await fetchTwitch();
        } else if (params.platform === "kick") {
          await fetchKick();
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
   *
   * `categoryName` (optional) lets the Kick lookup fall back to a slug-based
   * fetch when the numeric id doesn't resolve — required for cross-platform
   * browsing where a Twitch category needs to find its Kick counterpart by name.
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
        categoryName?: string;
        language?: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        const results: { platform: Platform; data: any[]; cursor?: string }[] = [];

        const fetchTwitch = async () => {
          try {
            const result = await twitchClient.getTopStreams({
              first: params.limit || 20,
              after: params.cursor,
              gameId: params.categoryId,
              language: params.language,
            });
            results.push({ platform: "twitch", data: result.data, cursor: result.cursor });
          } catch (err) {
            console.warn("⚠️ Failed to fetch Twitch streams by category:", err);
          }
        };

        const fetchKick = async () => {
          try {
            const result = await kickClient.getStreamsByCategory(params.categoryId, {
              limit: params.limit || 20,
              cursor: params.cursor,
              categoryName: params.categoryName,
              language: params.language,
            });
            results.push({
              platform: "kick",
              data: result.data,
              cursor: result.cursor ?? result.nextPage?.toString(),
            });
          } catch (err) {
            console.warn("⚠️ Failed to fetch Kick streams by category:", err);
          }
        };

        if (!params.platform) {
          await Promise.all([fetchTwitch(), fetchKick()]);
        } else if (params.platform === "twitch") {
          await fetchTwitch();
        } else if (params.platform === "kick") {
          await fetchKick();
        }

        if (!params.platform) {
          const allStreams = results.flatMap((r) => r.data);
          allStreams.sort((a, b) => b.viewerCount - a.viewerCount);
          return { success: true, data: allStreams };
        }

        // Single-platform request: always return a consistent shape even when
        // the platform fetch failed (results is empty). Avoid `...results[0]`
        // collapsing to `{success: true}` with no `data` field.
        const first = results[0];
        return {
          success: true,
          platform: first?.platform ?? params.platform,
          data: first?.data ?? [],
          cursor: first?.cursor,
        };
      } catch (error) {
        console.error("❌ Failed to get streams by category:", error);
        return {
          success: false,
          data: [],
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

        const fetchTwitchFollowed = async () => {
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
        };

        const fetchKickFollowed = async () => {
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

            // Stagger by 60ms each so N parallel /channels/{slug} fetches don't
            // fan-out on the same JS tick. The cold-TLS burst otherwise exhausts
            // the 5s per-request timeout (see PUBLIC_STREAM_REQUEST_TIMEOUT_MS in
            // stream-endpoints.ts) and produces recurring `[KickStream] timeout …
            // retrying` noise on every cache-miss cycle, even though the retry
            // succeeds. The positive cache in stream-endpoints handles cross-cycle
            // reuse; this stagger handles the within-cycle burst. The 4-slot
            // semaphore in kick-network-health naturally serializes beyond the
            // first 4, so the cumulative stagger is bounded by request time for
            // large follow lists.
            const FAN_OUT_STAGGER_MS = 60;
            const settled = await Promise.allSettled(
              uniqueSlugs.map((slug, i) =>
                (async () => {
                  if (i > 0) {
                    await new Promise((resolve) =>
                      setTimeout(resolve, FAN_OUT_STAGGER_MS * i)
                    );
                  }
                  return kickClient.getPublicStreamBySlug(slug);
                })()
              )
            );

            for (const result of settled) {
              if (result.status === "fulfilled") {
                if (result.value && !seenIds.has(result.value.id)) {
                  kickStreams.push(result.value);
                  seenIds.add(result.value.id);
                }
              } else {
                console.warn("Failed to fetch Kick stream:", result.reason);
              }
            }
          }

          results.push({ platform: "kick", data: kickStreams });
        };

        if (!params.platform) {
          await Promise.all([fetchTwitchFollowed(), fetchKickFollowed()]);
        } else if (params.platform === "twitch") {
          await fetchTwitchFollowed();
        } else if (params.platform === "kick") {
          await fetchKickFollowed();
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
