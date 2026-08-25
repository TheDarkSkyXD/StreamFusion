import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { logger } from "@/backend/logging/logger";
import { dedupeStreamsByChannelIdentity } from "@/lib/id-utils";
import type { Platform } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { IPlatformReader } from "../../api/unified/platform-reader";
import type { UnifiedStream } from "../../api/unified/platform-types";
import { clients } from "../../api/unified/registry";
import { storageService } from "../../services/storage-service";
import {
  getKickFollowScanSlugs,
  parseKickBroadcasterUserId,
  resolveKickFollowPlaybackSlug,
} from "./kick-follow-repair";

export const KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS = 0;
const FOLLOWED_STREAM_REQUEST_TTL_MS = 5_000;

type FollowedStreamResponse =
  | { success: true; data: UnifiedStream[]; platform?: Platform; cursor?: string; error?: string }
  | { success: false; data?: UnifiedStream[]; error: string };

const followedStreamResponses = new Map<
  string,
  { expiresAt: number; response: FollowedStreamResponse }
>();
const followedStreamRequests = new Map<string, Promise<FollowedStreamResponse>>();

function collapseFollowedStreamRequest(
  params: { platform?: Platform; limit?: number; cursor?: string },
  load: () => Promise<FollowedStreamResponse>
): Promise<FollowedStreamResponse> {
  const key = `${params.platform ?? "all"}:${params.limit ?? "default"}:${params.cursor ?? ""}`;
  const cached = followedStreamResponses.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.response);

  const pending = followedStreamRequests.get(key);
  if (pending) return pending;

  const request = load()
    .then((response) => {
      if (response.success && !response.error) {
        followedStreamResponses.set(key, {
          expiresAt: Date.now() + FOLLOWED_STREAM_REQUEST_TTL_MS,
          response,
        });
      }
      return response;
    })
    .finally(() => followedStreamRequests.delete(key));
  followedStreamRequests.set(key, request);
  return request;
}

export function isKickRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b429\b|rate[ -]?limit)/i.test(message);
}

export function shouldDeferKickStartupFollowedStreamScan(
  platform: Platform | undefined,
  now: number,
  handlersStartedAt: number
): boolean {
  if (platform !== undefined && platform !== "kick") return false;
  return now - handlersStartedAt < KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS;
}

export function registerStreamHandlers(): void {
  followedStreamResponses.clear();
  followedStreamRequests.clear();
  const streamHandlersStartedAt = Date.now();
  /**
   * Get top streams from one or both platforms.
   *
   * Per-platform try/catch is load-bearing — wrapHandler would lose partial results.
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
      // Touch the adapter modules so their `clients.register(...)` side effect runs.
      await import("../../api/platforms/twitch/twitch-client");
      await import("../../api/platforms/kick/kick-client");

      try {
        const fetchOne = async (
          reader: IPlatformReader
        ): Promise<{ platform: Platform; data: UnifiedStream[]; cursor?: string }> => {
          try {
            const result = await reader.getTopStreams({
              limit: params.limit || 20,
              cursor: params.cursor,
              categoryId: params.categoryId,
              language: params.language,
            });
            return { platform: reader.platform, data: result.data, cursor: result.cursor };
          } catch (err) {
            logger.warn("IPC:Stream", "Failed to fetch top streams", {
              platform: reader.platform,
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            return { platform: reader.platform, data: [] };
          }
        };

        const targets = params.platform ? [clients.for(params.platform)] : clients.all();
        const results = await Promise.all(targets.map((reader) => fetchOne(reader)));

        // Merge and sort by viewer count if fetching from both platforms
        if (!params.platform) {
          const allStreams = results.flatMap((r) => r.data);
          allStreams.sort((a, b) => b.viewerCount - a.viewerCount);
          return { success: true, data: allStreams.slice(0, params.limit || 20) };
        }

        return { success: true, ...results[0] };
      } catch (error) {
        logger.error("IPC:Stream", "Failed to get top streams", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
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
        const results: { platform: Platform; data: UnifiedStream[]; cursor?: string }[] = [];

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
            logger.warn("IPC:Stream", "Failed to fetch Twitch streams by category", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
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
            logger.warn("IPC:Stream", "Failed to fetch Kick streams by category", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
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
        logger.error("IPC:Stream", "Failed to get streams by category", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
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

      return collapseFollowedStreamRequest(params, async () => {
        try {
        const results: { platform: Platform; data: UnifiedStream[]; cursor?: string }[] = [];

        const fetchTwitchFollowed = async () => {
          const localTwitch = storageService.getActiveFollowsByPlatform("twitch");
          const twitchStreams: UnifiedStream[] = [];
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
              logger.warn("IPC:Stream", "Failed to fetch Twitch remote followed streams", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
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
                  logger.warn("IPC:Stream", "Failed to fetch local twitch streams via GQL", {
                    error:
                      e instanceof Error
                        ? { name: e.name, message: e.message, stack: e.stack }
                        : String(e),
                  });
                }

                const existingTwitch = results.find((r) => r.platform === "twitch");
                if (existingTwitch) {
                  existingTwitch.data = twitchStreams;
                } else if (twitchStreams.length > 0) {
                  results.push({ platform: "twitch", data: twitchStreams });
                }
              }
            } catch (err) {
              logger.warn("IPC:Stream", "Failed to fetch Twitch local followed streams", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
            }
          }
        };

        const fetchKickFollowed = async () => {
          const deferLocalFollowScan = shouldDeferKickStartupFollowedStreamScan(
            params.platform,
            Date.now(),
            streamHandlersStartedAt
          );
          const localKick = storageService.getActiveFollowsByPlatform("kick");
          const kickStreams: UnifiedStream[] = [];
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
              logger.warn("IPC:Stream", "Failed to fetch Kick remote followed streams", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
            }
          }

          // 2. Local Follows (Guest/Public)
          if (localKick.length > 0 && deferLocalFollowScan) {
            logger.info("IPC:Stream", "Deferred Kick followed-stream scan during startup", {
              followCount: localKick.length,
              graceMs: KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS,
            });
          } else if (localKick.length > 0) {
            const scanStartedAt = Date.now();
            const uniqueSlugs = await getKickFollowScanSlugs(kickClient, localKick);
            const stableBroadcasterIds = [
              ...new Set(
                localKick
                  .map((follow) => parseKickBroadcasterUserId(follow.channelId))
                  .filter((id): id is number => id !== null)
              ),
            ];
            let officialLiveLookupSucceeded = stableBroadcasterIds.length === 0;

            if (stableBroadcasterIds.length > 0) {
              try {
                const liveStreams =
                  await kickClient.getStreamsByBroadcasterIds(stableBroadcasterIds);
                for (const stream of liveStreams) {
                  if (!seenIds.has(stream.id)) {
                    kickStreams.push(stream);
                    seenIds.add(stream.id);
                  }
                }
                officialLiveLookupSucceeded = true;
              } catch (err) {
                if (isKickRateLimitError(err)) {
                  logger.info(
                    "IPC:Stream",
                    "Kick live-status bulk lookup rate limited; preserving cached renderer data"
                  );
                  throw err;
                }
                logger.warn(
                  "IPC:Stream",
                  "Failed to fetch Kick live status via official livestreams API; falling back to slug scan",
                  {
                    error:
                      err instanceof Error
                        ? { name: err.name, message: err.message, stack: err.stack }
                        : String(err),
                  }
                );
              }
            }

            const slugsToScan = officialLiveLookupSucceeded
              ? [
                  ...new Set(
                    localKick
                      .filter((follow) => parseKickBroadcasterUserId(follow.channelId) === null)
                      .map((follow) => follow.channelName)
                      .filter(Boolean)
                  ),
                ]
              : uniqueSlugs;

            // Stagger by 60ms each so N parallel /channels/{slug} fetches don't
            // fan-out on the same JS tick. The actual sleep lives inside
            // getPublicStreamBySlug, after its cache check — so warm-cache
            // polls return synchronously and only cache-miss work pays the
            // dispatch spread. Use one AbortController per scan; the sidebar
            // and /following page can query at the same time, and one visible
            // query must not cancel the other into a partial/empty result.
            const abort = new AbortController();

            const fanOutStaggerMs = 60;
            const settled = await Promise.allSettled(
              slugsToScan.map((slug, i) =>
                kickClient.getPublicStreamBySlug(slug, i * fanOutStaggerMs, abort.signal)
              )
            );

            for (const result of settled) {
              if (result.status === "fulfilled") {
                if (result.value && !seenIds.has(result.value.id)) {
                  kickStreams.push(result.value);
                  seenIds.add(result.value.id);
                }
              } else if ((result.reason as Error)?.message !== "AbortError") {
                logger.warn("IPC:Stream", "Failed to fetch Kick stream", {
                  error:
                    result.reason instanceof Error
                      ? {
                          name: result.reason.name,
                          message: result.reason.message,
                          stack: result.reason.stack,
                        }
                      : String(result.reason),
                });
              }
            }

            logger.debug("IPC:Stream", "Completed Kick followed-stream scan", {
              followCount: localKick.length,
              officialIdCount: stableBroadcasterIds.length,
              scannedCount: slugsToScan.length,
              liveCount: kickStreams.length,
              durationMs: Date.now() - scanStartedAt,
            });
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
          const allStreams = dedupeStreamsByChannelIdentity(results.flatMap((r) => r.data));
          allStreams.sort((a, b) => b.viewerCount - a.viewerCount);
          return { success: true, data: allStreams };
        }

        const result = results[0];
        return {
          success: true,
          ...(result || {}),
          data: dedupeStreamsByChannelIdentity(result?.data || []),
        };
        } catch (error) {
          logger.error("IPC:Stream", "Failed to get followed streams", {
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
          return {
            success: true,
            data: [],
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });
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
          stream = await kickClient.getStreamBySlug(params.username, {
            freshStatus: true,
          });
        }

        return { success: true, data: stream };
      } catch (error) {
        logger.error("IPC:Stream", "Failed to get stream by channel", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
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
      const { TwitchStreamResolver } =
        await import("../../api/platforms/twitch/twitch-stream-resolver");
      const { KickStreamResolver } = await import("../../api/platforms/kick/kick-stream-resolver");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      const twitchResolver = new TwitchStreamResolver();
      const kickResolver = new KickStreamResolver();

      try {
        if (params.platform === "twitch") {
          const result = await twitchResolver.getStreamPlaybackUrl(params.channelSlug);
          return { success: true, data: result };
        } else if (params.platform === "kick") {
          try {
            const result = await kickResolver.getStreamPlaybackUrl(params.channelSlug);
            return { success: true, data: result };
          } catch (error) {
            const repairedSlug = await resolveKickFollowPlaybackSlug(
              kickClient,
              params.channelSlug
            );
            if (repairedSlug && repairedSlug.toLowerCase() !== params.channelSlug.toLowerCase()) {
              logger.info("IPC:Stream", "Retrying Kick playback with repaired channel slug", {
                requestedSlug: params.channelSlug,
                repairedSlug,
              });
              const result = await kickResolver.getStreamPlaybackUrl(repairedSlug);
              return { success: true, data: result };
            }

            throw error;
          }
        }
        throw new Error(`Unsupported platform: ${params.platform}`);
      } catch (error) {
        // "Channel is offline" is expected behavior - don't log as error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.toLowerCase().includes("offline")) {
          logger.error("IPC:Stream", "Failed to get stream playback URL", {
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to resolve stream URL",
        };
      }
    }
  );
}
