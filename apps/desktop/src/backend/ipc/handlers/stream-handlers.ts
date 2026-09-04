import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { z } from "zod";

import { logger } from "@backend/logging/logger";
import type { CategoryStreamReader, IPlatformReader } from "@streamfusion/core/discovery";
import type { FollowedStreamReader } from "@streamfusion/core/follows";
import { dedupeStreamsByChannelIdentity } from "@/lib/id-utils";
import type { Platform } from "../../../shared/auth-types";
import {
  IPC_CHANNELS,
  type FollowedStreamsRequest,
  type StreamPlaybackRequest,
} from "../../../shared/ipc-channels";
import { isKickRateLimitError } from "../../api/platforms/kick/kick-error-classification";
import type { UnifiedChannel, UnifiedStream } from "../../../shared/platform-types";
import type { DiscoveryResult } from "../../../shared/discovery-types";
import { getPlatformHealth } from "../../api/unified/platform-health";
import { storageService } from "../../services/storage-service";
import {
  getKickFollowStatusTargets,
  resolveKickFollowPlaybackSlug,
} from "../../services/kick-follow-identity-service";
import { settleStreamProviders, type StreamProviderOutcome } from "./stream-discovery-results";

const FOLLOWED_STREAM_REQUEST_TTL_MS = 5_000;
const KICK_FOLLOWED_RATE_LIMIT_STALE_TTL_MS = 15 * 60_000;

const streamPlaybackRequestSchema = z
  .object({
    platform: z.enum(["twitch", "kick"]),
    channelSlug: z.string().trim().min(1).max(128),
    intent: z.enum(["play", "recover"]),
  })
  .strict();
const followedStreamsRequestSchema = z
  .object({ platform: z.enum(["twitch", "kick"]).optional() })
  .strict();
const platformSchema = z.enum(["twitch", "kick"]);
const pageLimitSchema = z.number().int().min(1).max(1_000).optional();
const cursorSchema = z.string().trim().min(1).max(2_048).optional();
const topStreamsRequestSchema = z
  .object({
    platform: platformSchema.optional(),
    categoryId: z.string().trim().min(1).max(128).optional(),
    language: z.string().trim().min(1).max(35).optional(),
    limit: pageLimitSchema,
    cursor: cursorSchema,
  })
  .strict();
const categoryStreamsRequestSchema = z
  .object({
    categoryId: z.string().trim().max(128).optional(),
    platform: platformSchema.optional(),
    limit: pageLimitSchema,
    cursor: cursorSchema,
    categoryName: z.string().trim().min(1).max(256).optional(),
    language: z.string().trim().min(1).max(35).optional(),
  })
  .strict()
  .refine((request) => Boolean(request.categoryId || request.categoryName));
const streamByChannelRequestSchema = z
  .object({
    platform: platformSchema,
    username: z.string().trim().min(1).max(128),
  })
  .strict();

function parseStreamPlaybackRequest(value: unknown): StreamPlaybackRequest | null {
  const parsed = streamPlaybackRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type FollowedStreamResponse = DiscoveryResult<UnifiedStream[]>;

export interface StreamHandlerDependencies {
  readonly readers: Readonly<Record<Platform, IPlatformReader<UnifiedStream>>>;
  readonly followedReaders: {
    readonly twitch: IPlatformReader<UnifiedStream> &
      FollowedStreamReader<"twitch", UnifiedStream, { first?: number; after?: string }> & {
        getFollowedStreamAccess(): Promise<
          { kind: "guest" } | { kind: "ready" } | { kind: "unavailable" }
        >;
        getStreamsByLogins(logins: string[]): Promise<{ data: UnifiedStream[] }>;
      };
    readonly kick: IPlatformReader<UnifiedStream> &
      FollowedStreamReader<"kick", UnifiedStream, { limit?: number; cursor?: string }> & {
        getChannelsByBroadcasterIds(ids: number[]): Promise<UnifiedChannel[]>;
        getPublicChannel(slug: string): Promise<UnifiedChannel | null>;
        getStreamsByBroadcasterIds(ids: number[]): Promise<UnifiedStream[]>;
        getPublicStreamBySlug(
          slug: string,
          staggerOffsetMs?: number,
          signal?: AbortSignal
        ): Promise<UnifiedStream | null>;
      };
  };
  readonly categoryReaders: Readonly<
    Record<Platform, CategoryStreamReader<Platform, UnifiedStream>>
  >;
}

const followedStreamResponses = new Map<
  string,
  { expiresAt: number; response: FollowedStreamResponse }
>();
const followedStreamRequests = new Map<string, Promise<FollowedStreamResponse>>();

function readKickFollowedStreamsCache(maxAgeMs: number, now = Date.now()): UnifiedStream[] | null {
  const snapshot = storageService.getKickFollowedStreamsCache();
  if (!snapshot || !Number.isFinite(snapshot.cachedAt) || now - snapshot.cachedAt > maxAgeMs) {
    return null;
  }

  const streams = snapshot.streams.filter(isCachedKickStream);
  return streams.length === snapshot.streams.length ? streams : null;
}

function isCachedKickStream(value: unknown): value is UnifiedStream {
  if (!value || typeof value !== "object") return false;
  const stream = value as Partial<UnifiedStream>;
  return (
    stream.platform === "kick" &&
    typeof stream.id === "string" &&
    typeof stream.channelId === "string" &&
    typeof stream.channelName === "string" &&
    typeof stream.channelDisplayName === "string" &&
    typeof stream.title === "string" &&
    typeof stream.viewerCount === "number" &&
    typeof stream.thumbnailUrl === "string" &&
    stream.isLive === true &&
    Array.isArray(stream.tags)
  );
}

function collapseFollowedStreamRequest(
  params: { platform?: Platform },
  load: () => Promise<FollowedStreamResponse>
): Promise<FollowedStreamResponse> {
  const key = params.platform ?? "all";
  const cached = followedStreamResponses.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.response);

  const pending = followedStreamRequests.get(key);
  if (pending) return pending;

  const request = load()
    .then((response) => {
      if (response.success) {
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

export function registerStreamHandlers({
  readers,
  followedReaders,
  categoryReaders,
}: StreamHandlerDependencies): void {
  followedStreamResponses.clear();
  followedStreamRequests.clear();
  /**
   * Get top streams from one or both platforms.
   *
   * Per-platform try/catch is load-bearing — wrapHandler would lose partial results.
   */
  ipcMain.handle(IPC_CHANNELS.STREAMS_GET_TOP, async (_event, request: unknown = {}) => {
    const parsedRequest = topStreamsRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return {
        success: false,
        error: "Invalid top-stream request",
        providers: { twitch: "failed", kick: "failed" },
      } satisfies DiscoveryResult<UnifiedStream[]>;
    }
    const params = parsedRequest.data;

    try {
      const fetchOne = async (
        reader: IPlatformReader<UnifiedStream>
      ): Promise<StreamProviderOutcome> => {
        try {
          const result = await reader.getTopStreams({
            limit: params.limit ?? 20,
            cursor: params.cursor,
            categoryId: params.categoryId,
            language: params.language,
          });
          return {
            platform: reader.platform,
            status: "complete",
            data: result.data,
            cursor: result.cursor,
          };
        } catch (err) {
          logger.warn("IPC:Stream", "Failed to fetch top streams", {
            platform: reader.platform,
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
          return {
            platform: reader.platform,
            status: "failed",
            data: [],
            error: `${reader.platform} streams are unavailable`,
          };
        }
      };

      const targets = params.platform ? [readers[params.platform]] : [readers.twitch, readers.kick];
      const results = await Promise.all(targets.map((reader) => fetchOne(reader)));
      return settleStreamProviders(
        targets.map((reader) => reader.platform),
        results,
        params.limit ?? 20
      );
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
        ...(params.platform ? { platform: params.platform } : {}),
        providers: Object.fromEntries(
          (params.platform ? [params.platform] : ["twitch", "kick"]).map((platform) => [
            platform,
            "failed",
          ])
        ),
      };
    }
  });

  /**
   * Get streams by category
   *
   * `categoryName` (optional) lets the Kick lookup fall back to a slug-based
   * fetch when the numeric id doesn't resolve — required for cross-platform
   * browsing where a Twitch category needs to find its Kick counterpart by name.
   */
  ipcMain.handle(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY, async (_event, request: unknown) => {
    const parsedRequest = categoryStreamsRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return {
        success: false,
        error: "Invalid category-stream request",
        providers: { twitch: "failed", kick: "failed" },
      } satisfies DiscoveryResult<UnifiedStream[]>;
    }
    const params = parsedRequest.data;
    const categoryId = params.categoryId ?? "";

    try {
      const results: StreamProviderOutcome[] = [];

      const fetchTwitch = async () => {
        try {
          const result = await categoryReaders.twitch.getStreamsByCategory(categoryId, {
            limit: params.limit ?? 20,
            cursor: params.cursor,
            categoryName: params.categoryName,
            language: params.language,
          });
          results.push({
            platform: "twitch",
            status: "complete",
            data: result.data,
            cursor: result.cursor,
          });
        } catch (err) {
          logger.warn("IPC:Stream", "Failed to fetch Twitch streams by category", {
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
          results.push({
            platform: "twitch",
            status: "failed",
            data: [],
            error: "twitch category streams are unavailable",
          });
        }
      };

      const fetchKick = async () => {
        try {
          const result = await categoryReaders.kick.getStreamsByCategory(categoryId, {
            limit: params.limit ?? 20,
            cursor: params.cursor,
            categoryName: params.categoryName,
            language: params.language,
          });
          results.push({
            platform: "kick",
            status: "complete",
            data: result.data,
            cursor: result.cursor,
          });
        } catch (err) {
          logger.warn("IPC:Stream", "Failed to fetch Kick streams by category", {
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
          results.push({
            platform: "kick",
            status: "failed",
            data: [],
            error: "kick category streams are unavailable",
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

      const requestedPlatforms: Platform[] = params.platform
        ? [params.platform]
        : ["twitch", "kick"];
      return settleStreamProviders(requestedPlatforms, results, params.limit);
    } catch (error) {
      logger.error("IPC:Stream", "Failed to get streams by category", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch streams",
        providers: Object.fromEntries(
          (params.platform ? [params.platform] : ["twitch", "kick"]).map((platform) => [
            platform,
            "failed",
          ])
        ),
      };
    }
  });

  /**
   * Get followed streams (requires authentication OR local follows)
   */
  ipcMain.handle(IPC_CHANNELS.STREAMS_GET_FOLLOWED, async (_event, request: unknown = {}) => {
    const parsedRequest = followedStreamsRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return {
        success: false,
        error: "Invalid followed-stream request",
        providers: { twitch: "failed", kick: "failed" },
      } satisfies FollowedStreamResponse;
    }
    const params: FollowedStreamsRequest = parsedRequest.data;
    const { twitch: twitchClient, kick: kickClient } = followedReaders;

    return collapseFollowedStreamRequest(params, async () => {
      try {
        const results: StreamProviderOutcome[] = [];

        const fetchTwitchFollowed = async () => {
          const localTwitch = storageService.getActiveFollowsByPlatform("twitch");
          const twitchStreams: UnifiedStream[] = [];
          const seenIds = new Set<string>();
          let attemptedSources = 0;
          let completedSources = 0;

          // 1. Remote (User Authenticated)
          const followedStreamAccess = await twitchClient.getFollowedStreamAccess();
          if (followedStreamAccess.kind === "ready") {
            attemptedSources += 1;
            try {
              const seenCursors = new Set<string>();
              let after: string | undefined;

              while (true) {
                const result = await twitchClient.getFollowedStreams({ first: 100, after });
                result.data.forEach((s) => {
                  if (!seenIds.has(s.id)) {
                    twitchStreams.push(s);
                    seenIds.add(s.id);
                  }
                });

                const nextCursor = result.cursor;
                if (!nextCursor || seenCursors.has(nextCursor)) break;
                seenCursors.add(nextCursor);
                after = nextCursor;
              }

              if (seenCursors.size > 0) {
                logger.debug("IPC:Stream", "Loaded all Twitch followed-stream pages", {
                  pageCount: seenCursors.size + 1,
                  liveCount: twitchStreams.length,
                });
              }
              completedSources += 1;
            } catch (err) {
              logger.warn("IPC:Stream", "Failed to fetch Twitch remote followed streams", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
            }
          } else if (followedStreamAccess.kind === "unavailable") {
            attemptedSources += 1;
            logger.warn("IPC:Stream", "Twitch remote followed streams are unavailable");
          }

          // 2. Local Follows (GQL - no auth needed, works for guests)
          if (localTwitch.length > 0) {
            attemptedSources += 1;
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
                  completedSources += 1;
                } catch (e) {
                  logger.warn("IPC:Stream", "Failed to fetch local twitch streams via GQL", {
                    error:
                      e instanceof Error
                        ? { name: e.name, message: e.message, stack: e.stack }
                        : String(e),
                  });
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

          const status =
            attemptedSources === 0 || completedSources === attemptedSources
              ? "complete"
              : completedSources > 0
                ? "partial"
                : "failed";
          results.push({
            platform: "twitch",
            status,
            data: twitchStreams,
            ...(status === "failed" ? { error: "twitch followed streams are unavailable" } : {}),
          });
        };

        const fetchKickFollowed = async () => {
          const preserveSnapshotDuringCooldown = () => {
            const snapshot = readKickFollowedStreamsCache(KICK_FOLLOWED_RATE_LIMIT_STALE_TTL_MS);
            results.push(
              snapshot
                ? { platform: "kick", status: "stale", data: snapshot }
                : {
                    platform: "kick",
                    status: "failed",
                    data: [],
                    error: "kick followed streams are rate limited",
                  }
            );
            logger.info("IPC:Stream", "Kick rate limit active; reused followed-stream snapshot", {
              liveCount: snapshot?.length ?? 0,
            });
          };
          const localKick = storageService.getActiveFollowsByPlatform("kick");
          const kickStreams: UnifiedStream[] = [];
          const seenIds = new Set<string>();
          let hadFailure = false;

          // 1. Remote (User Authenticated)
          if (kickClient.isAuthenticated()) {
            try {
              const result = await kickClient.getFollowedStreams();
              result.data.forEach((s) => {
                if (!seenIds.has(s.id)) {
                  kickStreams.push(s);
                  seenIds.add(s.id);
                }
              });
            } catch (err) {
              if (isKickRateLimitError(err)) {
                preserveSnapshotDuringCooldown();
                return;
              }
              hadFailure = true;
              logger.warn("IPC:Stream", "Failed to fetch Kick remote followed streams", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
            }
          }

          // 2. Local Follows (Guest/Public)
          if (localKick.length > 0) {
            const scanStartedAt = Date.now();
            const statusTargets = await getKickFollowStatusTargets(kickClient, localKick);
            const stableBroadcasterIds = statusTargets.broadcasterUserIds;
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
                  preserveSnapshotDuringCooldown();
                  return;
                }
                hadFailure = true;
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
              ? statusTargets.fallbackSlugs
              : statusTargets.allSlugs;

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
                hadFailure = true;
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

          const dedupedKickStreams = dedupeStreamsByChannelIdentity(kickStreams);
          const unhealthy = getPlatformHealth("kick") !== "healthy";
          const status =
            hadFailure || unhealthy
              ? dedupedKickStreams.length > 0
                ? "partial"
                : "failed"
              : "complete";
          if (status === "complete") {
            storageService.saveKickFollowedStreamsCache({
              cachedAt: Date.now(),
              streams: dedupedKickStreams,
            });
          }
          results.push({
            platform: "kick",
            status,
            data: dedupedKickStreams,
            ...(status === "failed" ? { error: "kick followed streams are unavailable" } : {}),
          });
        };

        if (!params.platform) {
          await Promise.all([fetchTwitchFollowed(), fetchKickFollowed()]);
        } else if (params.platform === "twitch") {
          await fetchTwitchFollowed();
        } else if (params.platform === "kick") {
          await fetchKickFollowed();
        }

        const requestedPlatforms: Platform[] = params.platform
          ? [params.platform]
          : ["twitch", "kick"];
        const settled = settleStreamProviders(requestedPlatforms, results);
        return settled.success
          ? { ...settled, data: dedupeStreamsByChannelIdentity(settled.data) }
          : settled;
      } catch (error) {
        if (isKickRateLimitError(error)) {
          const snapshot = readKickFollowedStreamsCache(KICK_FOLLOWED_RATE_LIMIT_STALE_TTL_MS);
          return snapshot
            ? {
                success: true,
                data: snapshot,
                platform: "kick",
                providers: { kick: "stale" },
              }
            : {
                success: false,
                error: "kick followed streams are rate limited",
                platform: "kick",
                providers: { kick: "failed" },
              };
        }
        logger.error("IPC:Stream", "Failed to get followed streams", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          ...(params.platform ? { platform: params.platform } : {}),
          providers: Object.fromEntries(
            (params.platform ? [params.platform] : ["twitch", "kick"]).map((platform) => [
              platform,
              "failed",
            ])
          ),
        };
      }
    });
  });

  /**
   * Get stream by channel username/slug
   */
  ipcMain.handle(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL, async (_event, request: unknown) => {
    const parsedRequest = streamByChannelRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return { success: false, error: "Invalid stream-channel request" };
    }
    const params = parsedRequest.data;

    try {
      let stream = null;

      if (params.platform === "twitch") {
        const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
        stream = await twitchClient.getStreamByLogin(params.username);
      } else if (params.platform === "kick") {
        const { kickClient } = await import("../../api/platforms/kick/kick-client");
        stream = await kickClient.getStreamBySlug(params.username, {
          freshStatus: true,
        });
      }

      return { success: true, data: stream };
    } catch (error) {
      if (params.platform === "kick" && isKickRateLimitError(error)) {
        const retryAfterMs =
          typeof error === "object" &&
          error !== null &&
          "retryAfterMs" in error &&
          typeof error.retryAfterMs === "number" &&
          Number.isFinite(error.retryAfterMs)
            ? Math.max(0, error.retryAfterMs)
            : 60_000;
        logger.debug("IPC:Stream", "Kick stream status refresh paused for API cooldown", {
          username: params.username,
          retryAfterMs,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kick API rate limit active",
          retryAfterMs,
        };
      }
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
  });

  /**
   * Get playback URL for a live stream
   * Ad-blocking is handled client-side via VAFT in the HLS player
   */
  ipcMain.handle(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL, async (_event, payload: unknown) => {
    const params = parseStreamPlaybackRequest(payload);
    if (!params) {
      return { success: false, error: "Invalid Stream playback request" };
    }

    try {
      if (params.platform === "twitch") {
        const { TwitchStreamResolver } =
          await import("../../api/platforms/twitch/twitch-stream-resolver");
        const twitchResolver = new TwitchStreamResolver();
        const result = await twitchResolver.getStreamPlaybackUrl(params.channelSlug);
        return { success: true, data: result };
      } else if (params.platform === "kick") {
        const [{ KickStreamResolver }, { kickClient }] = await Promise.all([
          import("../../api/platforms/kick/kick-stream-resolver"),
          import("../../api/platforms/kick/kick-client"),
        ]);
        const kickResolver = new KickStreamResolver();
        try {
          const result =
            params.intent === "recover"
              ? await kickResolver.getStreamPlaybackUrl(params.channelSlug, {
                  forceRefresh: true,
                })
              : await kickResolver.getStreamPlaybackUrl(params.channelSlug);
          return { success: true, data: result };
        } catch (error) {
          const resolvedSlug = await resolveKickFollowPlaybackSlug(kickClient, params.channelSlug);
          if (resolvedSlug && resolvedSlug.toLowerCase() !== params.channelSlug.toLowerCase()) {
            logger.info("IPC:Stream", "Retrying Kick playback with resolved channel slug", {
              requestedSlug: params.channelSlug,
              resolvedSlug,
            });
            const result =
              params.intent === "recover"
                ? await kickResolver.getStreamPlaybackUrl(resolvedSlug, {
                    forceRefresh: true,
                  })
                : await kickResolver.getStreamPlaybackUrl(resolvedSlug);
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
  });
}
