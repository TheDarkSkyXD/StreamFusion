import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { logger } from "@/backend/logging/logger";
import type { Platform } from "../../../shared/auth-types";
import type {
  CategoryClipsRequest,
  CategoryMediaResult,
  CategoryVideosRequest,
} from "../../../shared/category-media-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { KickStreamResolver } from "../../api/platforms/kick/kick-stream-resolver";
import { TwitchStreamResolver } from "../../api/platforms/twitch/twitch-stream-resolver";
import type { UnifiedClip } from "../../api/unified/platform-types";

type KickClip = Awaited<
  ReturnType<typeof import("../../api/platforms/kick/endpoints/clip-endpoints").getClipsByChannelSlug>
>["data"][number];
type KickVideo = Awaited<
  ReturnType<typeof import("../../api/platforms/kick/endpoints/video-endpoints").getVideosByChannelSlug>
>["data"][number];

// Instances
const twitchResolver = new TwitchStreamResolver();
const kickResolver = new KickStreamResolver();

// Helper to format Twitch duration string "1h2m30s" -> "1:02:30"
function formatTwitchDuration(duration: string): string {
  if (!duration) return "0:00";

  const hoursMatch = duration.match(/(\d+)h/);
  const minsMatch = duration.match(/(\d+)m/);
  const secsMatch = duration.match(/(\d+)s/);

  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const mins = minsMatch ? parseInt(minsMatch[1], 10) : 0;
  const secs = secsMatch ? parseInt(secsMatch[1], 10) : 0;

  const formattedSecs = secs.toString().padStart(2, "0");

  if (hours > 0) {
    const formattedMins = mins.toString().padStart(2, "0");
    return `${hours}:${formattedMins}:${formattedSecs}`;
  }

  return `${mins}:${formattedSecs}`;
}

// Helper to format seconds -> "1:02:30" or "2:30"
function formatSeconds(seconds: number): string {
  const duration = Math.round(seconds);
  const hours = Math.floor(duration / 3600);
  const mins = Math.floor((duration % 3600) / 60);
  const secs = duration % 60;

  const formattedSecs = secs.toString().padStart(2, "0");

  if (hours > 0) {
    const formattedMins = mins.toString().padStart(2, "0");
    return `${hours}:${formattedMins}:${formattedSecs}`;
  }

  return `${mins}:${formattedSecs}`;
}

/**
 * Get the livestream ID from a Kick video object, trying multiple field names
 * This centralizes the logic for matching clips to VODs
 */
function getKickVideoLivestreamId(video: KickVideo & { livestreamId?: string; live_stream_id?: string }): string | undefined {
  const id = video.livestreamId || video.live_stream_id || video.id;
  return id ? id.toString() : undefined;
}

function parseClipCreatedAtMs(raw: unknown): number {
  if (!raw) return 0;
  const value = String(raw);
  const directMs = Date.parse(value);
  if (Number.isFinite(directMs)) return directMs;

  // Kick can return microsecond timestamps like `.297186Z`; JS Date only
  // accepts millisecond precision, so trim fractional seconds to 3 digits.
  const normalized = value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:?\d{2})$/, "$1$2");
  const normalizedMs = Date.parse(normalized);
  return Number.isFinite(normalizedMs) ? normalizedMs : 0;
}

function getClipCreatedAtMs(clip: { createdAt?: string; created_at?: string; date?: string }): number {
  const raw = clip.createdAt || clip.created_at || clip.date;
  return parseClipCreatedAtMs(raw);
}

function sortClipsByCreatedAtDesc<
  T extends { createdAt?: string; created_at?: string; date?: string }
>(clips: T[]): T[] {
  return [...clips].sort((a, b) => getClipCreatedAtMs(b) - getClipCreatedAtMs(a));
}

function dedupeClipsById<T extends { id?: string }>(clips: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const clip of clips) {
    if (!clip.id || seen.has(clip.id)) continue;
    seen.add(clip.id);
    deduped.push(clip);
  }

  return deduped;
}

export type TimeRangeFilter = "day" | "week" | "month" | "all";

const DAY_MS = 24 * 60 * 60 * 1000;
const STRICT_CUTOFF_INTERNAL_PAGE_SIZE = 100;
const STRICT_CUTOFF_MAX_INTERNAL_PAGES = 5;
const TWITCH_RECENT_DATE_CANDIDATE_PAGE_SIZE = 100;

function getTwitchInitialDateCandidateFilters(timeRange: TimeRangeFilter | undefined): string[] {
  switch (timeRange) {
    case "week":
      return ["LAST_DAY", "LAST_WEEK"];
    case "month":
      return ["LAST_DAY", "LAST_WEEK", "LAST_MONTH"];
    case "all":
      return ["LAST_DAY", "LAST_WEEK", "LAST_MONTH"];
    default:
      return [];
  }
}

/** Inclusive on the older edge: a clip with createdAt === cutoff is in range. Null for "all". */
export function getCutoffMs(timeRange: TimeRangeFilter | undefined, nowMs: number): number | null {
  if (!timeRange || timeRange === "all") return null;
  switch (timeRange) {
    case "day":
      return nowMs - DAY_MS;
    case "week":
      return nowMs - 7 * DAY_MS;
    case "month":
      return nowMs - 30 * DAY_MS;
  }
}

export interface UpstreamPage<T> {
  items: T[];
  cursor: string | undefined;
}

export type FillPageStopReason = "filled" | "out-of-range" | "exhausted" | "max-pages";

export interface FillPageOptions<T> {
  cutoffMs: number;
  limit: number;
  initialCursor: string | undefined;
  maxInternalPages: number;
  fetchPage: (cursor: string | undefined) => Promise<UpstreamPage<T>>;
  getCreatedAtMs: (item: T) => number;
}

export interface FillPageResult<T> {
  inRange: T[];
  /** `undefined` signals upstream has nothing more in range — UI should stop loading more. */
  nextCursor: string | undefined;
  pagesFetched: number;
  candidatesSeen: number;
  reason: FillPageStopReason;
}

/** Assumes upstream returns items newest-first; the loop stops on the first out-of-range item. */
export async function fillPageWithCutoff<T>(opts: FillPageOptions<T>): Promise<FillPageResult<T>> {
  const inRange: T[] = [];
  let cursor = opts.initialCursor;
  let nextCursor = cursor;
  let pagesFetched = 0;
  let candidatesSeen = 0;
  let reason: FillPageStopReason | null = null;

  while (pagesFetched < opts.maxInternalPages) {
    const page = await opts.fetchPage(cursor);
    pagesFetched++;
    nextCursor = page.cursor;

    if (page.items.length === 0) {
      reason = "exhausted";
      break;
    }

    let pageSawOutOfRange = false;
    for (const item of page.items) {
      candidatesSeen++;
      if (opts.getCreatedAtMs(item) < opts.cutoffMs) {
        pageSawOutOfRange = true;
        break;
      }
      // Drain the whole page even past `limit`. Truncating mid-page would
      // discard in-range items: the upstream cursor advances to the NEXT page,
      // so anything we skipped on the current page is lost forever.
      inRange.push(item);
    }

    if (pageSawOutOfRange) {
      reason = "out-of-range";
      break;
    }
    if (inRange.length >= opts.limit) {
      reason = "filled";
      break;
    }
    if (!page.cursor) {
      reason = "exhausted";
      break;
    }
    cursor = page.cursor;
  }

  if (reason === null) reason = "max-pages";

  const stopMeansNoMore = reason === "out-of-range" || reason === "exhausted";

  return {
    inRange,
    nextCursor: stopMeansNoMore ? undefined : nextCursor,
    pagesFetched,
    candidatesSeen,
    reason,
  };
}

export interface ClipsGetByChannelParams {
  platform: Platform;
  channelName: string;
  channelId?: string;
  limit?: number;
  cursor?: string;
  sort?: "date" | "views";
  timeRange?: TimeRangeFilter;
}

export async function handleGetClipsByChannel(params: ClipsGetByChannelParams) {
  const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
  const { kickClient } = await import("../../api/platforms/kick/kick-client");

  try {
    if (params.platform === "twitch") {
      const channelLogin = params.channelName.toLowerCase();

      let gqlFilter: string = "LAST_WEEK";
      if (params.timeRange) {
        switch (params.timeRange) {
          case "day":
            gqlFilter = "LAST_DAY";
            break;
          case "week":
            gqlFilter = "LAST_WEEK";
            break;
          case "month":
            gqlFilter = "LAST_MONTH";
            break;
          case "all":
            gqlFilter = "ALL_TIME";
            break;
        }
      }

      const cutoffMs = getCutoffMs(params.timeRange, Date.now());
      const effectiveGqlFilter =
        params.sort === "date" && params.timeRange === "all" ? "LAST_MONTH" : gqlFilter;
      const shouldOverfetchRecentDateCandidates =
        params.sort === "date" && params.timeRange === "all";
      const gqlFirst = shouldOverfetchRecentDateCandidates
        ? Math.max(params.limit ?? 20, TWITCH_RECENT_DATE_CANDIDATE_PAGE_SIZE)
        : params.limit;
      const initialDateCandidateFilters =
        params.sort === "date" && !params.cursor
          ? getTwitchInitialDateCandidateFilters(params.timeRange)
          : [];

      let twitchClips: UnifiedClip[];
      let outputCursor: string | undefined;

      if (cutoffMs === null) {
        if (initialDateCandidateFilters.length > 0) {
          logger.debug("IPC:Video", "Fetching Twitch clips via date candidate buckets", {
            channelLogin,
            filters: initialDateCandidateFilters,
          });
          const pages = await Promise.all(
            initialDateCandidateFilters.map((filter) =>
              twitchClient.getClipsByChannel(channelLogin, {
                first: TWITCH_RECENT_DATE_CANDIDATE_PAGE_SIZE,
                filter,
              })
            )
          );
          twitchClips = dedupeClipsById(pages.flatMap((page) => page.data));
          outputCursor = pages.at(-1)?.cursor;

          if (twitchClips.length === 0 && effectiveGqlFilter !== gqlFilter) {
            const fallback = await twitchClient.getClipsByChannel(channelLogin, {
              first: gqlFirst,
              filter: gqlFilter,
            });
            twitchClips = fallback.data;
            outputCursor = fallback.cursor;
          }
        } else {
          logger.debug("IPC:Video", "Fetching Twitch clips via GQL", {
            channelLogin,
            gqlFilter: effectiveGqlFilter,
          });
          let clips = await twitchClient.getClipsByChannel(channelLogin, {
            first: gqlFirst,
            after: params.cursor,
            filter: effectiveGqlFilter,
          });
          if (clips.data.length === 0 && effectiveGqlFilter !== gqlFilter) {
            clips = await twitchClient.getClipsByChannel(channelLogin, {
              first: gqlFirst,
              after: params.cursor,
              filter: gqlFilter,
            });
          }
          twitchClips = clips.data;
          outputCursor = clips.cursor;
        }
        logger.debug("IPC:Video", "Fetched Twitch clips (GQL)", {
          count: twitchClips.length,
          channelLogin,
        });
      } else {
        const uiLimit = params.limit ?? 20;
        logger.debug("IPC:Video", "Twitch clip strict cutoff", {
          timeRange: params.timeRange,
          cutoff: new Date(cutoffMs).toISOString(),
          uiLimit,
          initialCursor: params.cursor ?? null,
          gqlFilter,
        });

        if (initialDateCandidateFilters.length > 0) {
          const pages = await Promise.all(
            initialDateCandidateFilters.map((filter) =>
              twitchClient.getClipsByChannel(channelLogin, {
                first: TWITCH_RECENT_DATE_CANDIDATE_PAGE_SIZE,
                filter,
              })
            )
          );
          twitchClips = dedupeClipsById(pages.flatMap((page) => page.data)).filter(
            (clip) => getClipCreatedAtMs(clip) >= cutoffMs
          );
          outputCursor = pages.at(-1)?.cursor;
        } else {
          const result = await fillPageWithCutoff<UnifiedClip>({
            cutoffMs,
            limit: uiLimit,
            initialCursor: params.cursor,
            maxInternalPages: STRICT_CUTOFF_MAX_INTERNAL_PAGES,
            fetchPage: async (cursor) => {
              const clips = await twitchClient.getClipsByChannel(channelLogin, {
                first: STRICT_CUTOFF_INTERNAL_PAGE_SIZE,
                after: cursor,
                filter: gqlFilter,
              });
              return { items: clips.data, cursor: clips.cursor };
            },
            getCreatedAtMs: (clip) => new Date(clip.createdAt).getTime(),
          });

          logger.debug("IPC:Video", "Twitch clip strict cutoff result", {
            pagesFetched: result.pagesFetched,
            candidatesSeen: result.candidatesSeen,
            inRange: result.inRange.length,
            reason: result.reason,
            nextCursor: result.nextCursor ?? null,
          });
          twitchClips = result.inRange;
          outputCursor = result.nextCursor;
        }
      }

      let sortedClips = twitchClips;
      if (params.sort === "views") {
        sortedClips = [...twitchClips].sort((a, b) => b.viewCount - a.viewCount);
      } else {
        sortedClips = sortClipsByCreatedAtDesc(twitchClips);
      }

      return {
        success: true,
        data: sortedClips.map((c) => ({
          id: c.id,
          title: c.title,
          duration: formatSeconds(c.duration),
          views: c.viewCount.toString(),
          date: new Date(c.createdAt).toISOString(),
          created_at: c.createdAt,
          creatorName: c.creatorName,
          thumbnailUrl: c.thumbnailUrl,
          embedUrl: c.embedUrl,
          url: c.clipUrl,
          shareUrl: c.shareUrl || `https://clips.twitch.tv/${c.id}`,
          platform: "twitch",
          gameName: c.gameName || "",
          language: "",
          vodId: "",
        })),
        cursor: outputCursor,
      };
    } else if (params.platform === "kick") {
      const isViewSortWithTimeParams =
        params.sort === "views" && params.timeRange && params.timeRange !== "all";
      let clipsData: KickClip[] = [];
      let outputCursor: string | undefined;

      if (isViewSortWithTimeParams) {
        logger.debug("IPC:Video", "Kick clip executing Deep Fetch strategy for view sort", {
          timeRange: params.timeRange,
        });

        const now = new Date();
        let cutoffDate = new Date(0);
        switch (params.timeRange) {
          case "day":
            cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case "week":
            cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "month":
            cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        }

        let currentCursor = params.cursor;
        let keepFetching = true;
        let pagesFetched = 0;
        const MAX_PAGES = 30;

        while (keepFetching && pagesFetched < MAX_PAGES) {
          logger.debug("IPC:Video", "Kick clip Deep Fetch page", {
            page: pagesFetched + 1,
            cursor: currentCursor ?? null,
          });
          const response = await kickClient.getClips(params.channelName, {
            limit: 100,
            cursor: currentCursor,
            sort: "date",
            timeRange: params.timeRange,
          });

          const pageClips = response.data || [];
          const count = pageClips.length;

          if (count === 0) {
            logger.debug("IPC:Video", "Kick clip page empty, stopping fetch");
            keepFetching = false;
          } else {
            clipsData.push(...pageClips);
            currentCursor = response.cursor;
            pagesFetched++;

            const firstDate = pageClips[0].created_at || pageClips[0].date;
            const lastDate = pageClips[count - 1].created_at || pageClips[count - 1].date;
            logger.debug("IPC:Video", "Kick clip page range", {
              page: pagesFetched,
              firstDate,
              lastDate,
            });

            const lastClipDate = new Date(lastDate);
            if (lastClipDate < cutoffDate) {
              logger.debug("IPC:Video", "Kick clip reached cutoff date, stopping", {
                cutoffDate: cutoffDate.toISOString(),
              });
              keepFetching = false;
            }

            if (!currentCursor) {
              logger.debug("IPC:Video", "Kick clip no next cursor, stopping");
              keepFetching = false;
            }
          }
        }

        const beforeFilter = clipsData.length;
        clipsData = clipsData.filter((c) => {
          const d = new Date(c.created_at || c.date);
          return d >= cutoffDate;
        });
        logger.debug("IPC:Video", "Kick clip Deep Fetch Result", {
          beforeFilter,
          afterFilter: clipsData.length,
          timeRange: params.timeRange,
        });

        logger.debug("IPC:Video", "Kick clip sorting by views", {
          count: clipsData.length,
        });
        clipsData.sort((a, b) => {
          const vA = parseInt(String(a.views).replace(/,/g, ""), 10) || 0;
          const vB = parseInt(String(b.views).replace(/,/g, ""), 10) || 0;
          return vB - vA;
        });

        clipsData.slice(0, 5).forEach((c, i) => {
          logger.debug("IPC:Video", "Kick clip top result", {
            rank: i + 1,
            views: c.views,
            title: c.title,
          });
        });

        outputCursor = undefined;
      } else {
        const cutoffMs = getCutoffMs(params.timeRange, Date.now());

        if (cutoffMs === null) {
          const response = await kickClient.getClips(params.channelName, {
            limit: params.limit,
            cursor: params.cursor,
            sort: params.sort,
            timeRange: params.timeRange,
          });
          clipsData = response.data || [];
          outputCursor = response.cursor;

          if (params.sort === "views" && clipsData.length > 0) {
            clipsData.sort((a, b) => {
              const viewsA = parseInt(String(a.views).replace(/,/g, ""), 10) || 0;
              const viewsB = parseInt(String(b.views).replace(/,/g, ""), 10) || 0;
              return viewsB - viewsA;
            });
          }
        } else {
          const uiLimit = params.limit ?? 20;
          logger.debug("IPC:Video", "Kick clip strict cutoff", {
            timeRange: params.timeRange,
            cutoff: new Date(cutoffMs).toISOString(),
            uiLimit,
            initialCursor: params.cursor ?? null,
          });

          const result = await fillPageWithCutoff<KickClip>({
            cutoffMs,
            limit: uiLimit,
            initialCursor: params.cursor,
            maxInternalPages: STRICT_CUTOFF_MAX_INTERNAL_PAGES,
            fetchPage: async (cursor) => {
              const response = await kickClient.getClips(params.channelName, {
                limit: STRICT_CUTOFF_INTERNAL_PAGE_SIZE,
                cursor,
                sort: params.sort,
                timeRange: params.timeRange,
              });
              return { items: response.data || [], cursor: response.cursor };
            },
            getCreatedAtMs: (clip) => new Date(clip.created_at || clip.date).getTime(),
          });

          logger.debug("IPC:Video", "Kick clip strict cutoff result", {
            pagesFetched: result.pagesFetched,
            candidatesSeen: result.candidatesSeen,
            inRange: result.inRange.length,
            reason: result.reason,
            nextCursor: result.nextCursor ?? null,
          });

          clipsData = result.inRange;
          outputCursor = result.nextCursor;
        }
      }

      if (params.sort === "date") {
        clipsData = sortClipsByCreatedAtDesc(clipsData);
      }

      const clipsToCheck = clipsData.slice(0, 50);

      if (clipsToCheck.length > 0) {
        try {
          const videos = await kickClient.getVideos(params.channelName, { limit: 50 });
          const availableVodIds = new Set<string>();
          if (videos.data) {
            for (const video of videos.data) {
              const vodId = getKickVideoLivestreamId(video);
              if (vodId) availableVodIds.add(vodId);
            }
          }

          clipsData = clipsData.map((clip, index) => {
            if (index >= 50) {
              return clip;
            }
            const hasVod = clip.vodId && availableVodIds.has(clip.vodId.toString());
            return { ...clip, vodId: hasVod ? clip.vodId : "" };
          });
        } catch (e) {
          logger.warn("IPC:Video", "Kick clip VOD check failed", {
            error:
              e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
          });
        }
      }

      return {
        success: true,
        data: clipsData,
        cursor: outputCursor,
      };
    }
    throw new Error(`Unsupported platform: ${params.platform} `);
  } catch (error) {
    logger.error("IPC:Video", "Failed to get clips", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return {
      error: error instanceof Error ? error.message : "Failed to fetch clips",
    };
  }
}

export function registerVideoHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CLIPS_GET_BY_CATEGORY,
    async (_event, request: CategoryClipsRequest): Promise<CategoryMediaResult> => {
      if (request.platform === "twitch") {
        if (request.sort === "date") {
          return {
            success: false,
            availability: "unsupported",
            errorCode: "unsupported",
            error: "Twitch Helix Category Clips does not support Most Recent ordering",
          };
        }

        try {
          const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
          const result = await twitchClient.getClipsByGame(request.categoryId, {
            first: request.limit,
            after: request.cursor,
          });
          const users = await twitchClient.getUsersById([
            ...new Set(result.data.map((clip) => clip.broadcaster_id)),
          ]);
          const usersById = new Map(users.map((user) => [user.id, user]));
          return {
            success: true,
            availability: "available",
            data: result.data.map((clip) => ({
              id: clip.id,
              title: clip.title,
              duration: formatSeconds(clip.duration),
              views: String(clip.view_count),
              date: clip.created_at,
              created_at: clip.created_at,
              thumbnailUrl: clip.thumbnail_url,
              platform: "twitch",
              channelId: clip.broadcaster_id,
              channelName: usersById.get(clip.broadcaster_id)?.login || clip.broadcaster_name,
              channelAvatar: usersById.get(clip.broadcaster_id)?.profileImageUrl || "",
              gameId: clip.game_id,
              gameName: request.categoryName || "",
              category: request.categoryName || "",
              creatorName: clip.creator_name,
              embedUrl: clip.embed_url,
              url: clip.url,
              shareUrl: clip.url,
              language: clip.language,
              vodId: clip.video_id,
            })),
            cursor: result.cursor,
          };
        } catch (error) {
          return {
            success: false,
            availability: "unavailable",
            errorCode: "upstream-error",
            error:
              error instanceof Error ? error.message : "Failed to fetch Twitch Category Clips",
          };
        }
      }
      if (!request.categorySlug) {
        return {
          success: false,
          availability: "unavailable",
          errorCode: "invalid-request",
          error: "Kick Category Clips require a category slug",
        };
      }

      try {
        const { kickClient } = await import("../../api/platforms/kick/kick-client");
        const result = await kickClient.getClipsByCategory(request.categorySlug, {
          limit: request.limit,
          cursor: request.cursor,
          sort: request.sort,
          timeRange: request.timeRange,
        });
        return {
          success: true,
          availability: "available",
          data: result.data,
          cursor: result.cursor,
        };
      } catch (error) {
        return {
          success: false,
          availability: "unavailable",
          errorCode: "upstream-error",
          error: error instanceof Error ? error.message : "Failed to fetch Kick Category Clips",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.VIDEOS_GET_BY_CATEGORY,
    async (_event, request: CategoryVideosRequest): Promise<CategoryMediaResult> => {
      if (request.platform === "kick") {
        return {
          success: false,
          availability: "unsupported",
          errorCode: "unsupported",
          error: "Kick does not provide a complete category-wide Video source",
        };
      }

      try {
        const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
        const result = await twitchClient.getVideosByGame(request.categoryId, {
          first: request.limit,
          after: request.cursor,
          sort: request.sort === "date" ? "time" : "views",
        });
        const users = await twitchClient.getUsersById([
          ...new Set(result.data.map((video) => video.user_id)),
        ]);
        const usersById = new Map(users.map((user) => [user.id, user]));
        return {
          success: true,
          availability: "available",
          data: result.data.map((video) => ({
            id: video.id,
            title: video.title,
            duration: video.duration,
            views: String(video.view_count),
            date: video.published_at,
            created_at: video.published_at,
            thumbnailUrl: video.thumbnail_url
              .replace("%{width}", "320")
              .replace("%{height}", "180"),
            platform: "twitch",
            channelId: video.user_id,
            channelName: video.user_login,
            channelAvatar: usersById.get(video.user_id)?.profileImageUrl || "",
            gameId: video.game_id || request.categoryId,
            gameName: video.game_name || request.categoryName || "",
            category: video.game_name || request.categoryName || "",
            url: video.url,
            shareUrl: video.url,
            language: video.language,
          })),
          cursor: result.cursor,
        };
      } catch (error) {
        return {
          success: false,
          availability: "unavailable",
          errorCode: "upstream-error",
          error:
            error instanceof Error ? error.message : "Failed to fetch Twitch Category Videos",
        };
      }
    }
  );

  /**
   * Get playback URL for a VOD
   */
  ipcMain.handle(
    IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL,
    async (
      _event,
      params: {
        platform: Platform;
        videoId: string;
      }
    ) => {
      try {
        if (params.platform === "twitch") {
          const result = await twitchResolver.getVodPlaybackUrl(params.videoId);
          return { success: true, data: result };
        } else if (params.platform === "kick") {
          const result = await kickResolver.getVodPlaybackUrl(params.videoId);
          return { success: true, data: result };
        }
        throw new Error(`Unsupported platform: ${params.platform}`);
      } catch (error) {
        logger.error("IPC:Video", "Failed to get VOD playback URL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to resolve VOD URL",
        };
      }
    }
  );

  /**
   * Get metadata for a VOD
   */
  ipcMain.handle(
    IPC_CHANNELS.VIDEOS_GET_METADATA,
    async (
      _event,
      params: {
        platform: Platform;
        videoId: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");

      try {
        if (params.platform === "twitch") {
          const video = await twitchClient.getVideoById(params.videoId);
          if (!video) {
            return { success: false, error: "Video not found" };
          }

          return {
            success: true,
            data: {
              id: video.id,
              title: video.title,
              channelId: video.channelId,
              channelName: video.channelName,
              channelDisplayName: video.channelDisplayName,
              channelAvatar: video.channelAvatar || null,
              views: video.viewCount,
              duration: formatSeconds(video.duration),
              createdAt: video.publishedAt,
              thumbnailUrl: video.thumbnailUrl,
              description: video.description,
              type: video.type,
              platform: "twitch",
              shareUrl: video.shareUrl || `https://www.twitch.tv/videos/${video.id}`,
            },
          };
        } else if (params.platform === "kick") {
          const metadata = await kickResolver.getVideoMetadata(params.videoId);
          return {
            success: true,
            data: metadata,
          };
        }

        throw new Error(`Unsupported platform: ${params.platform}`);
      } catch (error) {
        logger.error("IPC:Video", "Failed to get video metadata", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch video metadata",
        };
      }
    }
  );

  /**
   * Get videos by channel
   */
  ipcMain.handle(
    IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL,
    async (
      _event,
      params: {
        platform: Platform;
        channelName: string; // Keep for backward compat, used if channelId missing
        channelId?: string; // New: preferred way to lookup
        limit?: number;
        cursor?: string;
        sort?: "date" | "views"; // Sort option: 'date' (most recent) or 'views'
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        if (params.platform === "twitch") {
          // Use GQL API (no auth required) — fetches videos by channel login
          const channelLogin = params.channelName.toLowerCase();
          logger.debug("IPC:Video", "Fetching Twitch videos via GQL", { channelLogin });

          const videos = await twitchClient.getVideosByChannel(channelLogin, {
            first: params.limit,
            after: params.cursor,
          });
          logger.debug("IPC:Video", "Fetched Twitch videos (GQL)", {
            count: videos.data.length,
            channelLogin,
          });

          // Sort by views if requested
          let sortedVideos = videos.data;
          if (params.sort === "views") {
            sortedVideos = [...videos.data].sort((a, b) => b.viewCount - a.viewCount);
          }

          // Resolve Game Info via GQL
          const videoIds = videos.data.map((v) => v.id);
          let gameMap: Record<string, { id: string; name: string }> = {};

          if (videoIds.length > 0) {
            try {
              gameMap = await twitchClient.getVideosGameData(videoIds);
            } catch (err) {
              logger.error("IPC:Video", "Failed to resolve Twitch video game data via GQL", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
            }
          }

          const mappedData = sortedVideos.map((v) => {
            const gqlGame = gameMap[v.id];
            const gameName = gqlGame?.name || "";

            return {
              id: v.id,
              title: v.title,
              duration: formatSeconds(v.duration),
              views: v.viewCount.toString(),
              date: new Date(v.publishedAt).toISOString(),
              created_at: v.publishedAt,
              thumbnailUrl: v.thumbnailUrl,
              platform: "twitch",
              gameName: gameName,
              category: gameName,
              language: "",
              shareUrl: v.shareUrl || `https://www.twitch.tv/videos/${v.id}`,
            };
          });

          return {
            success: true,
            data: mappedData,
            cursor: videos.cursor,
            debug: `Channel: ${channelLogin}, Count: ${videos.data.length}`,
          };
        } else if (params.platform === "kick") {
          const videos = await kickClient.getVideos(params.channelName, {
            limit: params.limit,
            cursor: params.cursor, // Use cursor now for V2
            sort: params.sort, // Pass sort to Kick API
          });
          // Check if videos.data exists before logging length
          const count = videos.data ? videos.data.length : 0;

          // Apply client-side sorting (as fallback since Kick API may not reliably sort by views)
          if (videos.data && videos.data.length > 0 && params.sort === "views") {
            logger.debug("IPC:Video", "Sorting Kick videos by views (client-side)", {
              count: videos.data.length,
            });
            videos.data = [...videos.data].sort((a, b) => {
              const viewsA = parseInt(a.views, 10) || 0;
              const viewsB = parseInt(b.views, 10) || 0;
              return viewsB - viewsA; // Descending (most views first)
            });
          }

          return {
            success: true,
            ...videos,
            debug: `Kick Channel: ${params.channelName}, Count: ${count}`,
          };
        }
        throw new Error(`Unsupported platform: ${params.platform}`);
      } catch (error) {
        logger.error("IPC:Video", "Failed to get videos", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch videos",
        };
      }
    }
  );

  /**
   * Get clips by channel
   */
  ipcMain.handle(IPC_CHANNELS.CLIPS_GET_BY_CHANNEL, (_event, params: ClipsGetByChannelParams) =>
    handleGetClipsByChannel(params)
  );

  /**
   * Get playback URL for a clip
   */
  ipcMain.handle(
    IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL,
    async (
      _event,
      params: {
        platform: Platform;
        clipId: string;
        thumbnailUrl?: string;
        clipUrl?: string;
      }
    ) => {
      try {
        if (params.platform === "twitch") {
          // Twitch clips use GQL to fetch the actual video URL by clip slug/ID
          const result = await twitchResolver.getClipPlaybackUrl(params.clipId);
          return { success: true, data: result };
        } else if (params.platform === "kick") {
          // Kick clips have a direct video_url (passed as clipUrl)
          logger.debug("IPC:Video", "Kick clip playback request", {
            clipId: params.clipId,
            clipUrl: params.clipUrl,
            thumbnailUrl: params.thumbnailUrl,
          });

          if (!params.clipUrl) {
            logger.error("IPC:Video", "No clipUrl provided for Kick clip playback");
            throw new Error("Clip URL required for Kick clip playback");
          }

          logger.debug("IPC:Video", "Kick clip returning playback URL", {
            clipUrl: params.clipUrl,
          });

          // Detect format based on URL - Kick clips use HLS (.m3u8)
          const format = params.clipUrl.includes(".m3u8") ? "hls" : "mp4";
          logger.debug("IPC:Video", "Kick clip detected format", { format });

          return {
            success: true,
            data: {
              url: params.clipUrl,
              format: format,
            },
          };
        }
        throw new Error(`Unsupported platform: ${params.platform} `);
      } catch (error) {
        logger.error("IPC:Video", "Failed to get clip playback URL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to resolve clip URL",
        };
      }
    }
  );

  /**
   * Get Kick VOD by livestream ID (for clip-to-VOD navigation)
   * Fetches the channel's videos and finds one with matching live_stream_id
   */
  ipcMain.handle(
    IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID,
    async (
      _event,
      params: {
        channelSlug: string;
        livestreamId: string;
      }
    ) => {
      try {
        logger.debug("IPC:Video", "Kick VOD lookup", {
          livestreamId: params.livestreamId,
          channelSlug: params.channelSlug,
        });

        const { kickClient } = await import("../../api/platforms/kick/kick-client");

        // Fetch videos from the channel (may need multiple pages to find the VOD)
        let cursor: string | undefined;
        let attempts = 0;
        const maxAttempts = 5; // Limit to avoid infinite loops

        while (attempts < maxAttempts) {
          attempts++;
          const videos = await kickClient.getVideos(params.channelSlug, {
            limit: 50,
            cursor: cursor,
          });

          if (!videos.data || videos.data.length === 0) {
            break;
          }

          // Look for a video with matching livestream ID
          // The video data structure has live_stream_id from the raw API, but our mapped data might use different fields
          // We need to check against the livestreamId we're looking for
          for (const video of videos.data) {
            // Use centralized helper for consistent ID extraction
            const videoLivestreamId = getKickVideoLivestreamId(video);

            if (videoLivestreamId && videoLivestreamId === params.livestreamId?.toString()) {
              logger.debug("IPC:Video", "Kick VOD lookup found matching VOD", {
                videoId: video.id,
                title: video.title,
              });

              // Return the video data with source URL for direct playback
              // Include all metadata needed by the Video page
              return {
                success: true,
                data: {
                  id: video.id,
                  uuid: video.uuid || "",
                  title: video.title,
                  source: video.source, // Direct HLS URL
                  thumbnailUrl: video.thumbnailUrl,
                  duration: video.duration,
                  views: video.views,
                  date: video.date,
                  channelSlug: video.channelSlug,
                  channelName: video.channelName || video.channelSlug || params.channelSlug,
                  channelDisplayName: video.channelName || video.channelSlug || params.channelSlug,
                  channelAvatar: video.channelAvatar || null,
                  category: video.category,
                  language: video.language || "",
                  shareUrl: video.shareUrl,
                },
              };
            }
          }

          // Continue to next page if available
          if (videos.cursor) {
            cursor = videos.cursor;
          } else {
            break;
          }
        }

        logger.debug("IPC:Video", "Kick VOD lookup not found", {
          livestreamId: params.livestreamId,
        });
        return {
          success: false,
          error: "VOD not found - it may have been deleted or is not yet available",
        };
      } catch (error) {
        logger.error("IPC:Video", "Failed to lookup Kick VOD by livestream ID", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to lookup VOD",
        };
      }
    }
  );
}
