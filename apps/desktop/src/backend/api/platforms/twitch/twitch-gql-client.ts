/**
 * Twitch GQL Client
 *
 * Provides public data access via Twitch's GraphQL API without requiring
 * any API keys or OAuth tokens. Uses the `twitch-gql-queries` package
 * for type-safe queries with the well-known web Client-ID.
 *
 * This replaces most Helix API calls for public data:
 * - Stream listing (top streams, streams by channel, streams by category)
 * - Channel info (shell, about panel)
 * - Category browsing (all directories, directory page)
 * - Search (channels, categories)
 * - Video/clip metadata
 * - Playback access tokens
 * - User lookups
 */

import {
  type BrowsePageAllDirectoriesData,
  type ChannelRootAboutPanelData,
  type ChannelShellData,
  type ClipsCardsUserData,
  type DirectoryPageGameData,
  type DirectoryPageGameStream,
  type FilterableVideoTowerVideosData,
  getQueryBowsePageAllDirectories,
  getQueryChannelRootAboutPanel,
  getQueryChannelShell,
  getQueryClipsCardsUser,
  getQueryDirectoryPageGame,
  getQueryFilterableVideoTowerVideos,
  getQueryGetUserId,
  getQueryPlaybackAccessToken,
  getQuerySearchResultsPageSearchResults,
  getQueryStreamMetadata,
  getQueryUseLive,
  getQueryUseViewCount,
  getQueryVideoAccessTokenClip,
  getQueryVideoMetadata,
  getRawQuery,
  type PlaybackAccessTokenData,
  type SearchResultsPageSearchResultsData,
  type StreamMetadataData,
  type UseLiveData,
  type UseViewCountData,
  type VideoAccessTokenClipData,
  type VideoMetadataData,
} from "twitch-gql-queries";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../unified/platform-types";
import type { PaginatedResult, PaginationOptions } from "./twitch-types";

const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const MAX_QUERIES_PER_REQUEST = 35;

/**
 * Custom gqlRequest that works within Electron (uses global fetch).
 * The `twitch-gql-queries` package's built-in gqlRequest uses browser fetch,
 * which works fine in Electron's main process since Electron exposes fetch.
 */
async function gqlRequest<T extends readonly any[]>(queries: [...T]): Promise<any[]> {
  if (queries.length === 0) return [];
  if (queries.length > MAX_QUERIES_PER_REQUEST) {
    throw new Error(`Too many queries. Max: ${MAX_QUERIES_PER_REQUEST}`);
  }

  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Client-Id": GQL_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(queries),
  });

  if (!res.ok) {
    throw new Error(`GQL request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Helper to transform GQL stream data → UnifiedStream
 */
function transformGqlStream(
  stream: DirectoryPageGameStream,
  overrides: Partial<UnifiedStream> = {}
): UnifiedStream {
  const thumbnailUrl = stream.previewImageURL.replace("{width}", "440").replace("{height}", "248");

  return {
    id: stream.id,
    platform: "twitch",
    channelId: stream.broadcaster?.id || "",
    channelName: stream.broadcaster?.login || "",
    channelDisplayName: stream.broadcaster?.displayName || "",
    channelAvatar: stream.broadcaster?.profileImageURL || "",
    title: stream.title,
    viewerCount: stream.viewersCount,
    thumbnailUrl,
    isLive: stream.type === "live",
    startedAt: null, // DirectoryPage streams don't include startedAt
    language: "",
    tags: stream.freeformTags?.map((t) => t.name) || [],
    isMature: stream.previewThumbnailProperties?.blurReason !== "BLUR_NOT_REQUIRED",
    categoryId: stream.game?.id,
    categoryName: stream.game?.displayName || stream.game?.name,
    ...overrides,
  };
}

// ============================================================
// PUBLIC DATA ACCESS (No API Key Required)
// ============================================================

/**
 * Get top streams across all categories or filtered by a specific game slug.
 * Uses DirectoryPage_Game GQL query for category-filtered streams,
 * or a raw "BrowsePage" style query for general top streams.
 */
export async function gqlGetTopStreams(
  options: PaginationOptions & { gameId?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const limit = options.first || 20;

  if (options.gameId) {
    // Use DirectoryPage_Game for category-specific streams
    // We need the game slug, but we have a game ID — use a raw query to handle this
    const [response] = (await gqlRequest([
      getQueryDirectoryPageGame({
        slug: options.gameId, // This could be slug or ID; we'll handle both
        options: {
          sort: "VIEWER_COUNT",
          recommendationsContext: { platform: "web" },
          ...(options.language ? { broadcasterLanguages: [options.language] } : {}),
        },
        sortTypeIsRecency: false,
        limit,
        includeIsDJ: false,
      }),
    ])) as [{ data: DirectoryPageGameData }];

    const game = response.data?.game;
    if (!game) return { data: [] };

    const streams = game.streams.edges.map((edge) => transformGqlStream(edge.node));

    const lastCursor = game.streams.edges[game.streams.edges.length - 1]?.cursor;
    return {
      data: streams,
      cursor: game.streams.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
    };
  }

  // For general top streams without a category filter, we use a raw query
  // that fetches the top live streams across all categories
  const query = `
    query GetTopStreams($limit: Int!, $cursor: Cursor) {
      streams(first: $limit, after: $cursor) {
        edges {
          cursor
          node {
            id
            title
            viewersCount
            previewImageURL(width: 440, height: 248)
            type
            broadcaster {
              id
              login
              displayName
              profileImageURL(width: 70)
              primaryColorHex
              roles { isPartner __typename }
              __typename
            }
            freeformTags { id name __typename }
            game {
              id
              boxArtURL
              name
              displayName
              slug
              __typename
            }
            previewThumbnailProperties {
              blurReason
              __typename
            }
            __typename
          }
          __typename
        }
        pageInfo { hasNextPage __typename }
        __typename
      }
    }
  `;

  type TopStreamsData = {
    streams: {
      edges: {
        cursor: string;
        node: DirectoryPageGameStream;
        __typename: string;
      }[];
      pageInfo: { hasNextPage: boolean };
    };
  };

  const [response] = (await gqlRequest([
    getRawQuery<TopStreamsData>({
      query,
      variables: {
        limit,
        cursor: options.after || null,
      },
    }),
  ])) as [{ data: TopStreamsData; errors?: any[] }];

  if (response.errors) {
    console.warn(
      "⚠️ [GQL] TopStreams query errors:",
      response.errors.map((e: any) => e.message).join(", ")
    );
  }

  const data = response.data;
  if (!data?.streams) return { data: [] };

  const streams = data.streams.edges.map((edge) => transformGqlStream(edge.node));

  const lastCursor = data.streams.edges[data.streams.edges.length - 1]?.cursor;
  return {
    data: streams,
    cursor: data.streams.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
  };
}

/**
 * Get stream by channel login (check if live + metadata)
 */
export async function gqlGetStreamByLogin(login: string): Promise<UnifiedStream | null> {
  const [streamMeta, viewCount] = (await gqlRequest([
    getQueryStreamMetadata({ channelLogin: login, includeIsDJ: false }),
    getQueryUseViewCount({ channelLogin: login }),
  ])) as [{ data: StreamMetadataData }, { data: UseViewCountData }];

  const user = streamMeta.data?.user;
  if (!user?.stream) return null;

  const stream = user.stream;
  const viewers = viewCount.data?.user?.stream?.viewersCount ?? 0;

  return {
    id: stream.id,
    platform: "twitch",
    channelId: user.id,
    channelName: login,
    channelDisplayName: login, // StreamMetadata doesn't include displayName directly
    channelAvatar: user.profileImageURL || "",
    title: user.lastBroadcast?.title || "",
    viewerCount: viewers,
    thumbnailUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-440x248.jpg`,
    isLive: stream.type === "live",
    startedAt: stream.createdAt || null,
    language: "",
    tags: [],
    categoryId: stream.game?.id,
    categoryName: stream.game?.name,
  };
}

/**
 * Get streams by multiple user logins (batch)
 * Uses UseLive + StreamMetadata for each login
 */
export async function gqlGetStreamsByLogins(logins: string[]): Promise<UnifiedStream[]> {
  if (logins.length === 0) return [];

  // Batch UseLive queries to check which channels are live
  const queries = logins.map((login) => getQueryUseLive({ channelLogin: login }));

  // Chunk into batches of MAX_QUERIES_PER_REQUEST
  const results: UnifiedStream[] = [];
  for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_REQUEST) {
    const batch = queries.slice(i, i + MAX_QUERIES_PER_REQUEST);
    const responses = (await gqlRequest(batch)) as { data: UseLiveData }[];

    // For live channels, fetch full metadata
    const liveLogins: string[] = [];
    for (let j = 0; j < responses.length; j++) {
      const user = responses[j].data?.user;
      if (user?.stream) {
        liveLogins.push(logins[i + j]);
      }
    }

    // Fetch detailed metadata for live channels
    if (liveLogins.length > 0) {
      const detailQueries = liveLogins.flatMap((login) => [
        getQueryStreamMetadata({ channelLogin: login, includeIsDJ: false }),
        getQueryUseViewCount({ channelLogin: login }),
      ]);

      for (let k = 0; k < detailQueries.length; k += MAX_QUERIES_PER_REQUEST) {
        const detailBatch = detailQueries.slice(k, k + MAX_QUERIES_PER_REQUEST);
        const detailResponses = await gqlRequest(detailBatch);

        // Process pairs (StreamMetadata + UseViewCount)
        for (let m = 0; m < detailResponses.length; m += 2) {
          const meta = detailResponses[m] as { data: StreamMetadataData };
          const vc = detailResponses[m + 1] as { data: UseViewCountData };
          const loginIdx = Math.floor(m / 2);
          const login = liveLogins[k / 2 + loginIdx] || liveLogins[loginIdx];

          const user = meta.data?.user;
          if (!user?.stream) continue;

          results.push({
            id: user.stream.id,
            platform: "twitch",
            channelId: user.id,
            channelName: login,
            channelDisplayName: login,
            channelAvatar: user.profileImageURL || "",
            title: user.lastBroadcast?.title || "",
            viewerCount: vc.data?.user?.stream?.viewersCount ?? 0,
            thumbnailUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-440x248.jpg`,
            isLive: true,
            startedAt: user.stream.createdAt || null,
            language: "",
            tags: [],
            categoryId: user.stream.game?.id,
            categoryName: user.stream.game?.name,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Get top categories/games (browse page)
 */
export async function gqlGetTopCategories(
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  const limit = options.first || 20;

  const [response] = (await gqlRequest([
    getQueryBowsePageAllDirectories({
      limit,
      options: {
        sort: "VIEWER_COUNT",
        recommendationsContext: { platform: "web" },
      },
      cursor: options.after || null,
    }),
  ])) as [{ data: BrowsePageAllDirectoriesData }];

  const dirs = response.data?.directoriesWithTags;
  if (!dirs) return { data: [] };

  const categories: UnifiedCategory[] = dirs.edges.map((edge) => ({
    id: edge.node.id,
    platform: "twitch" as const,
    name: edge.node.displayName || edge.node.name,
    boxArtUrl: edge.node.avatarURL.replace("{width}", "285").replace("{height}", "380"),
    viewerCount: edge.node.viewersCount ?? undefined,
  }));

  const lastCursor = dirs.edges[dirs.edges.length - 1]?.cursor;
  return {
    data: categories,
    cursor: dirs.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
  };
}

/**
 * Get ALL top categories with automatic pagination
 */
export async function gqlGetAllTopCategories(): Promise<UnifiedCategory[]> {
  const allCategories: UnifiedCategory[] = [];
  let cursor: string | undefined;
  const perPage = 30; // GQL seems to prefer smaller pages

  while (true) {
    const result = await gqlGetTopCategories({
      first: perPage,
      after: cursor,
    });

    allCategories.push(...result.data);
    cursor = result.cursor;

    if (!cursor || result.data.length < perPage) break;
    if (allCategories.length >= 2000) {
      console.warn("⚠️ Twitch GQL category fetch hit safety limit (2000)");
      break;
    }
  }

  return allCategories;
}

/**
 * Search for channels via GQL
 */
export async function gqlSearchChannels(
  query: string,
  options: PaginationOptions & { liveOnly?: boolean } = {}
): Promise<PaginatedResult<UnifiedChannel>> {
  const [response] = (await gqlRequest([
    getQuerySearchResultsPageSearchResults({
      query,
      includeIsDJ: false,
    }),
  ])) as [{ data: SearchResultsPageSearchResultsData }];

  const searchData = response.data?.searchFor;
  if (!searchData) return { data: [] };

  let channels = searchData.channels.edges.map((edge) => {
    const ch = edge.item;
    return {
      id: ch.id,
      platform: "twitch" as const,
      username: ch.login,
      displayName: ch.displayName,
      avatarUrl: ch.profileImageURL || "",
      bio: ch.description || undefined,
      isLive: !!ch.stream,
      isVerified: ch.roles?.isPartner || false,
      isPartner: ch.roles?.isPartner || false,
      followerCount: ch.followers?.totalCount ?? undefined,
      lastStreamTitle: ch.broadcastSettings?.title || undefined,
      // If live, include stream info
      ...(ch.stream
        ? {
            categoryId: ch.stream.game?.id,
            categoryName: ch.stream.game?.displayName || ch.stream.game?.name,
          }
        : {}),
    } satisfies UnifiedChannel;
  });

  // Filter live-only if requested
  if (options.liveOnly) {
    channels = channels.filter((ch) => ch.isLive);
  }

  return {
    data: channels,
    cursor: searchData.channels.cursor || undefined,
  };
}

/**
 * Search for categories via GQL
 */
export async function gqlSearchCategories(
  query: string,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  const [response] = (await gqlRequest([
    getQuerySearchResultsPageSearchResults({
      query,
      options: {
        targets: [{ index: "GAME" }],
      },
      includeIsDJ: false,
    }),
  ])) as [{ data: SearchResultsPageSearchResultsData }];

  const searchData = response.data?.searchFor;
  if (!searchData) return { data: [] };

  const categories: UnifiedCategory[] = searchData.games.edges.map((edge) => {
    const game = edge.item;
    return {
      id: game.id,
      platform: "twitch" as const,
      name: game.displayName || game.name,
      boxArtUrl: game.boxArtURL.replace("{width}", "285").replace("{height}", "380"),
      viewerCount: game.viewersCount ?? undefined,
    };
  });

  return {
    data: categories,
    cursor: searchData.games.cursor || undefined,
  };
}

/**
 * Get channel info via GQL (ChannelShell)
 */
export async function gqlGetChannelByLogin(login: string): Promise<UnifiedChannel | null> {
  const [shellResp, aboutResp] = (await gqlRequest([
    getQueryChannelShell({ login }),
    getQueryChannelRootAboutPanel({
      channelLogin: login,
      skipSchedule: true,
      includeIsDJ: false,
    }),
  ])) as [{ data: ChannelShellData }, { data: ChannelRootAboutPanelData }];

  const userOrErr = shellResp.data?.userOrError;
  if (!userOrErr || "userDoesNotExist" in userOrErr) return null;

  const shell = userOrErr;
  const about = aboutResp.data?.user;

  return {
    id: shell.id,
    platform: "twitch",
    username: shell.login,
    displayName: shell.displayName,
    avatarUrl: shell.profileImageURL || "",
    bannerUrl: shell.bannerImageURL || undefined,
    bio: about?.description || undefined,
    isLive: !!shell.stream,
    isVerified: about?.roles?.isPartner || false,
    isPartner: about?.roles?.isPartner || false,
    followerCount: about?.followers?.totalCount ?? undefined,
    socialLinks: about?.channel?.socialMedias?.map((s) => ({
      platform: s.name,
      url: s.url,
    })),
  };
}

/**
 * Get channels by multiple logins
 */
export async function gqlGetChannelsByLogins(logins: string[]): Promise<UnifiedChannel[]> {
  if (logins.length === 0) return [];

  const queries = logins.map((login) => getQueryChannelShell({ login }));
  const channels: UnifiedChannel[] = [];

  for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_REQUEST) {
    const batch = queries.slice(i, i + MAX_QUERIES_PER_REQUEST);
    const responses = (await gqlRequest(batch)) as { data: ChannelShellData }[];

    for (let j = 0; j < responses.length; j++) {
      const userOrErr = responses[j].data?.userOrError;
      if (!userOrErr || "userDoesNotExist" in userOrErr) continue;

      const shell = userOrErr;
      channels.push({
        id: shell.id,
        platform: "twitch",
        username: shell.login,
        displayName: shell.displayName,
        avatarUrl: shell.profileImageURL || "",
        bannerUrl: shell.bannerImageURL || undefined,
        isLive: !!shell.stream,
        isVerified: false, // Would need AboutPanel for this
        isPartner: false,
      });
    }
  }

  return channels;
}

/**
 * Get user ID by login (simple lookup)
 */
export async function gqlGetUserIdByLogin(login: string): Promise<string | null> {
  const [response] = (await gqlRequest([getQueryGetUserId({ login, lookupType: "ACTIVE" })])) as [
    { data: { user: { id: string } | null } },
  ];

  return response.data?.user?.id || null;
}

/**
 * Get videos for a channel
 */
export async function gqlGetVideosByChannel(
  channelLogin: string,
  options: PaginationOptions & { type?: "archive" | "highlight" | "upload" } = {}
): Promise<PaginatedResult<UnifiedVideo>> {
  const limit = options.first || 20;

  const broadcastType =
    options.type === "archive"
      ? "ARCHIVE"
      : options.type === "highlight"
        ? "HIGHLIGHT"
        : options.type === "upload"
          ? "UPLOAD"
          : null;

  const [response] = (await gqlRequest([
    getQueryFilterableVideoTowerVideos({
      limit,
      channelOwnerLogin: channelLogin,
      broadcastType,
      videoSort: "TIME",
    }),
  ])) as [{ data: FilterableVideoTowerVideosData }];

  const videos = response.data?.user?.videos;
  if (!videos) return { data: [] };

  const result: UnifiedVideo[] = videos.edges.map((edge) => {
    const v = edge.node;
    const thumbnailUrl = v.previewThumbnailURL
      .replace("{width}", "320")
      .replace("{height}", "180")
      .replace("%{width}", "320")
      .replace("%{height}", "180");

    return {
      id: v.id,
      platform: "twitch" as const,
      channelId: v.owner?.id || "",
      channelName: v.owner?.login || channelLogin,
      channelDisplayName: v.owner?.displayName || channelLogin,
      channelAvatar: v.owner?.profileImageURL || "",
      title: v.title || "",
      thumbnailUrl,
      duration: v.lengthSeconds,
      viewCount: v.viewCount,
      publishedAt: v.publishedAt || "",
      url: `https://www.twitch.tv/videos/${v.id}`,
      type: "archive", // FilterableVideoTower doesn't expose broadcastType directly
    };
  });

  const lastCursor = videos.edges[videos.edges.length - 1]?.cursor;
  return {
    data: result,
    cursor: videos.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
  };
}

/**
 * Get clips for a channel via GQL
 */
export async function gqlGetClipsByChannel(
  channelLogin: string,
  options: PaginationOptions & { filter?: string } = {}
): Promise<PaginatedResult<UnifiedClip>> {
  const limit = options.first || 20;
  const filter =
    (options.filter as "LAST_DAY" | "LAST_WEEK" | "LAST_MONTH" | "ALL_TIME") || "LAST_WEEK";

  const [response] = (await gqlRequest([
    getQueryClipsCardsUser({
      login: channelLogin,
      limit,
      criteria: { filter },
      cursor: options.after || null,
    }),
  ])) as [{ data: ClipsCardsUserData }];

  const clips = response.data?.user?.clips;
  if (!clips) return { data: [] };

  const result: UnifiedClip[] = clips.edges.map((edge) => {
    const c = edge.node;
    return {
      id: c.id,
      platform: "twitch" as const,
      channelId: c.broadcaster?.id || "",
      channelName: c.broadcaster?.login || channelLogin,
      channelDisplayName: c.broadcaster?.displayName || channelLogin,
      channelAvatar: c.broadcaster?.profileImageURL || "",
      title: c.title,
      thumbnailUrl: c.thumbnailURL || "",
      clipUrl: c.url,
      embedUrl: c.embedURL,
      duration: c.durationSeconds,
      viewCount: c.viewCount,
      createdAt: c.createdAt,
      creatorName: c.curator?.displayName || "",
      gameId: c.game?.id,
      gameName: c.game?.name,
    };
  });

  const lastCursor = clips.edges[clips.edges.length - 1]?.cursor;
  return {
    data: result,
    cursor: clips.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
  };
}

/**
 * Get playback access token for a live stream (via GQL)
 * This replaces TwitchStreamResolver.getPlaybackAccessToken for live streams
 */
export async function gqlGetPlaybackAccessToken(
  login: string
): Promise<{ value: string; signature: string }> {
  const [response] = (await gqlRequest([
    getQueryPlaybackAccessToken({
      isLive: true,
      login,
      isVod: false,
      vodID: "",
      playerType: "site",
      platform: "web",
    }),
  ])) as [{ data: PlaybackAccessTokenData }];

  const token = response.data?.streamPlaybackAccessToken;
  if (!token) {
    throw new Error("No stream token found. The channel might be offline.");
  }

  return { value: token.value, signature: token.signature };
}

/**
 * Get playback access token for a VOD (via GQL)
 */
export async function gqlGetVodAccessToken(
  vodId: string
): Promise<{ value: string; signature: string }> {
  const [response] = (await gqlRequest([
    getQueryPlaybackAccessToken({
      isLive: false,
      login: "",
      isVod: true,
      vodID: vodId,
      playerType: "site",
      platform: "web",
    }),
  ])) as [{ data: PlaybackAccessTokenData }];

  const token = response.data?.videoPlaybackAccessToken;
  if (!token) {
    throw new Error("No VOD token found. The VOD might be sub-only or deleted.");
  }

  return { value: token.value, signature: token.signature };
}

/**
 * Get clip access token and qualities (via GQL)
 */
export async function gqlGetClipAccessToken(slug: string): Promise<{
  qualities: { quality: string; sourceURL: string; frameRate?: number }[];
  signature: string;
  value: string;
}> {
  const [response] = (await gqlRequest([getQueryVideoAccessTokenClip({ slug })])) as [
    { data: VideoAccessTokenClipData },
  ];

  const clip = response.data?.clip;
  if (!clip) {
    throw new Error("Clip not found");
  }

  return {
    qualities: clip.videoQualities.map((q) => ({
      quality: q.quality,
      sourceURL: q.sourceURL,
      frameRate: q.frameRate,
    })),
    signature: clip.playbackAccessToken.signature,
    value: clip.playbackAccessToken.value,
  };
}

/**
 * Get video metadata via GQL
 */
export async function gqlGetVideoMetadata(
  videoId: string,
  channelLogin: string = ""
): Promise<UnifiedVideo | null> {
  const [response] = (await gqlRequest([
    getQueryVideoMetadata({ videoID: videoId, channelLogin }),
  ])) as [{ data: VideoMetadataData }];

  const video = response.data?.video;
  if (!video) return null;

  const thumbnailUrl = video.previewThumbnailURL
    .replace("{width}", "320")
    .replace("{height}", "180")
    .replace("%{width}", "320")
    .replace("%{height}", "180");

  const broadcastType =
    video.broadcastType === "ARCHIVE"
      ? "archive"
      : video.broadcastType === "HIGHLIGHT"
        ? "highlight"
        : "upload";

  return {
    id: video.id,
    platform: "twitch",
    channelId: video.owner.id,
    channelName: video.owner.login,
    channelDisplayName: video.owner.displayName,
    channelAvatar: "",
    title: video.title || "",
    description: video.description || undefined,
    thumbnailUrl,
    duration: video.lengthSeconds,
    viewCount: video.viewCount,
    publishedAt: video.publishedAt || video.createdAt,
    url: `https://www.twitch.tv/videos/${video.id}`,
    type: broadcastType,
  };
}

/**
 * Check if a channel is live (lightweight)
 */
export async function gqlIsChannelLive(login: string): Promise<boolean> {
  const [response] = (await gqlRequest([getQueryUseLive({ channelLogin: login })])) as [
    { data: UseLiveData },
  ];

  return !!response.data?.user?.stream;
}

/**
 * Get follower count for a channel via GQL (from AboutPanel)
 */
export async function gqlGetFollowerCount(login: string): Promise<number | null> {
  try {
    const [response] = (await gqlRequest([
      getQueryChannelRootAboutPanel({
        channelLogin: login,
        skipSchedule: true,
        includeIsDJ: false,
      }),
    ])) as [{ data: ChannelRootAboutPanelData }];

    return response.data?.user?.followers?.totalCount ?? null;
  } catch {
    return null;
  }
}

/**
 * Batch fetch game data for multiple videos via GQL
 * Uses raw aliased queries since GQL doesn't support batch video lookups
 */
export async function gqlFetchGamesForVideos(
  videoIds: string[]
): Promise<Record<string, { id: string; name: string }>> {
  if (!videoIds.length) return {};

  const validIds = videoIds.filter((id) => /^\d+$/.test(id));
  if (!validIds.length) return {};

  const queryFields = validIds
    .map(
      (id) => `
        v${id}: video(id: "${id}") {
          id
          game {
            id
            displayName
            name
          }
        }
      `
    )
    .join("\n");

  const query = `query GetVideosGameData { ${queryFields} }`;

  type VideoGameData = {
    id: string;
    game: { id: string; displayName: string; name?: string } | null;
  };

  const [response] = (await gqlRequest([
    getRawQuery<Record<string, VideoGameData>>({ query }),
  ])) as [{ data: Record<string, VideoGameData> }];

  const result: Record<string, { id: string; name: string }> = {};

  if (response.data) {
    for (const videoData of Object.values(response.data)) {
      if (videoData?.game) {
        result[videoData.id] = {
          id: videoData.game.id,
          name: videoData.game.displayName || videoData.game.name || "",
        };
      }
    }
  }

  return result;
}
