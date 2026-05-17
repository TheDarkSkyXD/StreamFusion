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
  type DirectoryPageGameStream,
  type FilterableVideoTowerVideosData,
  getQueryBowsePageAllDirectories,
  getQueryChannelRootAboutPanel,
  getQueryChannelShell,
  getQueryClipsCardsUser,
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
// Anonymous public-data Client-Id. Twitch's web Client-Id (kimne78…) pairs
// with an integrity token in real browser traffic — without it, anonymous
// requests (especially persisted queries) trip the integrity check. The
// Android-app Client-Id (same one Xtra uses) doesn't enforce that pairing,
// so it's the right default for every anonymous GQL call in this client.
// (The playback / ad-block / manifest-proxy paths still use the web ID
// because they simulate the web client with paired Client-Integrity headers.)
const GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
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
 * POST a single persisted query (not an array). Twitch's pre-registered
 * persisted queries bypass the integrity check that blocks paginated
 * anonymous raw queries.
 */
async function sendPersistedQuery<T>(
  operationName: string,
  sha256Hash: string,
  variables: Record<string, unknown>
): Promise<{ data?: T; errors?: { message: string }[] }> {
  const body = {
    operationName,
    variables,
    extensions: { persistedQuery: { version: 1, sha256Hash } },
  };
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: { "Client-Id": GQL_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

// Process-lifetime cache: gameId → slug. Populated on first lookup of a
// category that didn't already arrive with a slug (e.g. deep-link / page reload).
const gameSlugCache = new Map<string, string>();

/**
 * Resolve a numeric Twitch game ID → URL slug. The DirectoryPage_Game
 * persisted query keys off slug, not id, so we need this one-time lookup
 * before paginating. Result is cached for the process lifetime.
 */
async function resolveGameSlugById(gameId: string): Promise<string | null> {
  const cached = gameSlugCache.get(gameId);
  if (cached) return cached;

  const query = `query GetGameSlug($id: ID!) { game(id: $id) { slug } }`;
  const [res] = (await gqlRequest([
    getRawQuery<{ game: { slug: string } | null }>({ query, variables: { id: gameId } }),
  ])) as [{ data: { game: { slug: string } | null } }];

  const slug = res.data?.game?.slug;
  if (slug) gameSlugCache.set(gameId, slug);
  return slug ?? null;
}

/**
 * Fetch Twitch category-level content tags. Single raw GQL request — the
 * Helix /games/top response doesn't carry tags, so this is the only way to
 * surface them.
 */
export async function gqlGetGameMetadata(gameId: string): Promise<{ tags: string[] } | null> {
  const query = `query GameMetadata($id: ID!) {
    game(id: $id) {
      id
      tags(tagType: CONTENT) {
        id
        localizedName
      }
    }
  }`;

  try {
    const [res] = (await gqlRequest([
      getRawQuery<{
        game: null | {
          id: string;
          tags: { id: string; localizedName: string | null }[] | null;
        };
      }>({ query, variables: { id: gameId } }),
    ])) as [
      {
        data: {
          game: null | {
            tags: { id: string; localizedName: string | null }[] | null;
          };
        };
      },
    ];

    const game = res.data?.game;
    if (!game) return null;

    const tags = (game.tags || [])
      .map((t) => t.localizedName?.trim() || "")
      .filter((s) => s.length > 0);
    return { tags };
  } catch (err) {
    console.warn(`[Twitch] gqlGetGameMetadata failed for ${gameId}:`, err);
    return null;
  }
}

/**
 * Fetch streams for a category via the `DirectoryPage_Game` persisted query
 * (same hash + variable shape Xtra uses). Persisted queries bypass the
 * integrity check that blocks paginated anonymous raw queries — which is why
 * this path scales past the ~100-stream wall the raw-query path hits.
 */
export async function gqlGetGameStreamsBySlug(
  slug: string,
  options: { first?: number; after?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const limit = Math.min(options.first ?? 30, 30);
  const res = await sendPersistedQuery<{
    game: null | {
      streams: null | {
        edges: { cursor: string | null; node: DirectoryPageGameStream }[];
        pageInfo: { hasNextPage: boolean };
      };
    };
  }>("DirectoryPage_Game", "76cb069d835b8a02914c08dc42c421d0dafda8af5b113a3f19141824b901402f", {
    cursor: options.after ?? null,
    imageWidth: 50,
    includeCostreaming: true,
    limit,
    options: {
      // Twitch's `Language` GraphQL enum uses uppercase 2-letter codes
      // (EN, ES, FR, …); sending lowercase ISO codes fails enum validation
      // and the server returns zero streams.
      broadcasterLanguages: options.language ? [options.language.toUpperCase()] : [],
      freeformTags: [],
      sort: "VIEWER_COUNT",
    },
    slug,
    sortTypeIsRecency: false,
  });

  if (res.errors?.length) {
    // PersistedQueryNotFound = Twitch retired the hash. Surface loud so we notice.
    const msg = res.errors.map((e) => e.message).join(", ");
    throw new Error(`DirectoryPage_Game persisted query failed: ${msg}`);
  }

  const conn = res.data?.game?.streams;
  if (!conn) return { data: [] };

  const streams = conn.edges.map((e) => transformGqlStream(e.node));
  const lastCursor = conn.edges[conn.edges.length - 1]?.cursor;
  return {
    data: streams,
    cursor: conn.pageInfo.hasNextPage ? (lastCursor ?? undefined) : undefined,
  };
}

/**
 * Get streams for a single game/category by ID, with cursor-based pagination.
 *
 * Primary path: resolve gameId → slug, then call `DirectoryPage_Game`
 * (persisted query). Bypasses the integrity check that caps the raw path.
 * Fallback: the raw `game(id:).streams` query (hits the ~100-stream wall but
 * works as a last resort if the persisted hash gets retired).
 */
export async function gqlGetStreamsByGameId(
  gameId: string,
  options: { first?: number; after?: string; language?: string; slug?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const slug = options.slug ?? (await resolveGameSlugById(gameId));
  if (slug) {
    try {
      return await gqlGetGameStreamsBySlug(slug, options);
    } catch (err) {
      console.warn("⚠️ DirectoryPage_Game persisted query failed, falling back to raw:", err);
    }
  }
  return gqlGetStreamsByGameIdRaw(gameId, options);
}

/**
 * Raw-query fallback for {@link gqlGetStreamsByGameId}. Works for the first
 * page (and ~100 streams total) but anonymous paginated raw queries trip
 * Twitch's "failed integrity check" — which we swallow here as end-of-stream
 * since this is the last-resort path.
 */
async function gqlGetStreamsByGameIdRaw(
  gameId: string,
  options: { first?: number; after?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  // Twitch's `Game.streams(first:)` field is capped at 100 per request.
  // Going above this triggers "argument 'first' value must be between 1 and 100".
  const first = Math.min(options.first || 20, 100);

  const query = `
    query GetStreamsByGameId($id: ID!, $first: Int!, $after: Cursor, $options: GameStreamOptions) {
      game(id: $id) {
        id
        streams(first: $first, after: $after, options: $options) {
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
              previewThumbnailProperties { blurReason __typename }
              __typename
            }
            __typename
          }
          pageInfo { hasNextPage __typename }
          __typename
        }
        __typename
      }
    }
  `;

  type StreamsByGameIdData = {
    game: null | {
      id: string;
      streams: null | {
        edges: { cursor: string; node: DirectoryPageGameStream; __typename: string }[];
        pageInfo: { hasNextPage: boolean };
      };
    };
  };

  const [response] = (await gqlRequest([
    getRawQuery<StreamsByGameIdData>({
      query,
      variables: {
        id: gameId,
        first,
        after: options.after || null,
        options: {
          sort: "VIEWER_COUNT",
          // See gqlGetGameStreamsBySlug — Twitch's Language enum is uppercase.
          ...(options.language ? { broadcasterLanguages: [options.language.toUpperCase()] } : {}),
        },
      },
    }),
  ])) as [{ data: StreamsByGameIdData; errors?: any[] }];

  if (response.errors) {
    // "failed integrity check" is Twitch's expected response to paginated
    // anonymous raw queries (after: <cursor>). Treat it as end-of-stream
    // instead of logging noise.
    const messages = response.errors.map((e: any) => e.message).join(", ");
    if (!messages.includes("failed integrity check")) {
      console.warn("⚠️ [GQL] GetStreamsByGameId query errors:", messages);
    }
  }

  const streamsConn = response.data?.game?.streams;
  if (!streamsConn) return { data: [] };

  const streams = streamsConn.edges.map((edge) => transformGqlStream(edge.node));
  const lastCursor = streamsConn.edges[streamsConn.edges.length - 1]?.cursor;
  const cursor = streamsConn.pageInfo.hasNextPage ? lastCursor || undefined : undefined;
  return { data: streams, cursor };
}

/**
 * Get top streams across all categories or filtered by a specific game ID.
 */
export async function gqlGetTopStreams(
  options: PaginationOptions & { gameId?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const limit = options.first || 20;

  if (options.gameId) {
    return gqlGetStreamsByGameId(options.gameId, {
      first: limit,
      after: options.after,
      language: options.language,
    });
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

  // Twitch GQL caps `streams(first:)` at 30. Clamp to avoid argument-range errors.
  const [response] = (await gqlRequest([
    getRawQuery<TopStreamsData>({
      query,
      variables: {
        limit: Math.min(limit, 30),
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

// Persisted StreamMetadata doesn't carry freeformTags or broadcastSettings.language,
// so we fetch them via a raw user(login:) side query and merge by login.
const STREAM_TAGS_AND_LANGUAGE_QUERY = `query StreamTagsAndLanguage($login: String!) {
  user(login: $login) {
    stream { freeformTags { id name } }
    broadcastSettings { language }
  }
}`;

type StreamTagsAndLanguageData = {
  user: null | {
    stream: null | { freeformTags: { id: string; name: string }[] | null };
    broadcastSettings: null | { language: string | null };
  };
};

function getRawTagsAndLanguageQuery(login: string) {
  return getRawQuery<StreamTagsAndLanguageData>({
    query: STREAM_TAGS_AND_LANGUAGE_QUERY,
    variables: { login },
  });
}

function extractTagsAndLanguage(data: StreamTagsAndLanguageData | undefined): {
  tags: string[];
  language: string;
} {
  const user = data?.user;
  const tags = user?.stream?.freeformTags?.map((t) => t.name) ?? [];
  // broadcastSettings.language is uppercase BCP-47 (e.g. "EN"); downstream code
  // expects lowercase to match Helix's "en".
  const language = (user?.broadcastSettings?.language ?? "").toLowerCase();
  return { tags, language };
}

async function getTagsAndLanguageByLogins(
  logins: string[]
): Promise<Map<string, { tags: string[]; language: string }>> {
  const result = new Map<string, { tags: string[]; language: string }>();
  if (logins.length === 0) return result;

  try {
    const queries = logins.map((login) => getRawTagsAndLanguageQuery(login));
    for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_REQUEST) {
      const batch = queries.slice(i, i + MAX_QUERIES_PER_REQUEST);
      const responses = (await gqlRequest(batch)) as { data: StreamTagsAndLanguageData }[];
      for (let j = 0; j < responses.length; j++) {
        result.set(logins[i + j], extractTagsAndLanguage(responses[j].data));
      }
    }
  } catch (err) {
    // Best-effort enrichment: if the side query fails the caller still gets
    // streams (with empty tags/language), matching pre-fix behavior.
    console.warn("[Twitch] getTagsAndLanguageByLogins failed:", err);
  }
  return result;
}

/**
 * Get stream by channel login (check if live + metadata)
 */
export async function gqlGetStreamByLogin(login: string): Promise<UnifiedStream | null> {
  const [streamMeta, viewCount, tagsLang] = (await gqlRequest([
    getQueryStreamMetadata({ channelLogin: login, includeIsDJ: false }),
    getQueryUseViewCount({ channelLogin: login }),
    getRawTagsAndLanguageQuery(login),
  ])) as [
    { data: StreamMetadataData },
    { data: UseViewCountData },
    { data: StreamTagsAndLanguageData },
  ];

  const user = streamMeta.data?.user;
  if (!user?.stream) return null;

  const stream = user.stream;
  const viewers = viewCount.data?.user?.stream?.viewersCount ?? 0;
  const { tags, language } = extractTagsAndLanguage(tagsLang.data);

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
    language,
    tags,
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
  const allLiveLogins: string[] = [];
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

      allLiveLogins.push(...liveLogins);
    }
  }

  // Persisted StreamMetadata doesn't include freeformTags or
  // broadcastSettings.language — fetch them via a raw side query and merge by login.
  if (allLiveLogins.length > 0) {
    const tagsLangByLogin = await getTagsAndLanguageByLogins(allLiveLogins);
    for (const stream of results) {
      const extra = tagsLangByLogin.get(stream.channelName);
      if (extra) {
        stream.tags = extra.tags;
        stream.language = extra.language;
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
    slug: edge.node.slug,
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

    // End-of-list is signalled by the cursor alone — `gqlGetTopCategories`
    // already maps `pageInfo.hasNextPage === false` to `cursor: undefined`.
    // Do NOT short-circuit on `data.length < perPage`: Twitch's
    // BrowsePage_AllDirectories regularly returns fewer items than `limit`
    // (mature/restricted/region filtering happens after the page-size cap)
    // even when `hasNextPage` is true, which used to terminate the loop
    // after the first short page and miss the long tail of categories.
    if (!cursor || result.data.length === 0) break;
    if (allCategories.length >= 5000) {
      console.warn("⚠️ Twitch GQL category fetch hit safety limit (5000)");
      break;
    }
  }

  return allCategories;
}

/**
 * Get a single category/game by ID via GQL (unauthenticated).
 * Twitch GQL exposes a top-level `game(id:)` resolver.
 */
export async function gqlGetCategoryById(id: string): Promise<UnifiedCategory | null> {
  const query = `
    query GetGameById($id: ID!) {
      game(id: $id) {
        id
        name
        displayName
        slug
        boxArtURL
        viewersCount
        __typename
      }
    }
  `;

  type GameByIdData = {
    game: null | {
      id: string;
      name: string;
      displayName: string | null;
      slug: string | null;
      boxArtURL: string;
      viewersCount: number | null;
    };
  };

  const [response] = (await gqlRequest([
    getRawQuery<GameByIdData>({ query, variables: { id } }),
  ])) as [{ data: GameByIdData; errors?: any[] }];

  if (response.errors) {
    console.warn(
      "⚠️ [GQL] GetGameById query errors:",
      response.errors.map((e: any) => e.message).join(", ")
    );
  }

  const game = response.data?.game;
  if (!game) return null;

  return {
    id: game.id,
    platform: "twitch",
    name: game.displayName || game.name,
    slug: game.slug ?? undefined,
    boxArtUrl: game.boxArtURL.replace("{width}", "285").replace("{height}", "380"),
    viewerCount: game.viewersCount ?? undefined,
  };
}

/**
 * Filter Twitch GQL response errors. `"failed integrity check"` is Twitch's
 * expected rejection for anonymous paginated raw queries — treat it as a
 * legitimate end-of-list signal rather than logging noise. Surface every
 * other error via console.warn so dev sees it.
 */
function processGqlSearchErrors(
  context: string,
  errors: { message: string }[] | undefined
): { isIntegrityRejected: boolean } {
  if (!errors || errors.length === 0) return { isIntegrityRejected: false };

  const messages = errors.map((e) => e.message).join(", ");
  if (messages.includes("failed integrity check")) {
    return { isIntegrityRejected: true };
  }

  console.warn(`⚠️ [GQL] ${context} query errors:`, messages);
  return { isIntegrityRejected: false };
}

type SearchChannelEdgeItem =
  SearchResultsPageSearchResultsData["searchFor"]["channels"]["edges"][number]["item"];

function transformSearchChannel(ch: SearchChannelEdgeItem): UnifiedChannel {
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
    ...(ch.stream
      ? {
          categoryId: ch.stream.game?.id,
          categoryName: ch.stream.game?.displayName || ch.stream.game?.name,
        }
      : {}),
  } satisfies UnifiedChannel;
}

/**
 * Raw-GQL LoadMore for channels — used only on page 2+ (when `after` is set).
 *
 * Twitch's bundled `SearchResultsPage_SearchResults` persisted op ignores
 * cursor input (it re-serves page 1 with the same cursor every call), so
 * pagination requires a hand-written query. The persisted op is used on
 * page 1 (no `after`); this helper takes over for page 2+.
 *
 * Anonymous paginated raw queries are sometimes rejected with
 * "failed integrity check" depending on Twitch's enforcement at that moment.
 * That's caught upstream and reported as end-of-list.
 */
async function gqlSearchChannelsLoadMore(
  query: string,
  after: string,
  first: number | undefined
): Promise<{ data: UnifiedChannel[]; cursor: string | undefined; errors?: { message: string }[] }> {
  // Empirically discovered constraints (see SearchChannels query errors when
  // probing this against gql.twitch.tv): searchFor requires a non-null
  // platform argument, the channels connection does NOT accept cursor/first
  // arguments, and edge.item is a `SearchForItem` union — concrete fields
  // must be selected through an inline fragment on the channel branch.
  const rawQuery = `
    query SearchResultsPageLoadMoreChannels($query: String!, $platform: String!) {
      searchFor(userQuery: $query, platform: $platform, options: {targets: [{index: CHANNEL}]}) {
        channels {
          cursor
          edges {
            trackingID
            item {
              ... on User {
                id
                login
                displayName
                profileImageURL(width: 70)
                description
                stream {
                  id
                  game { id displayName name __typename }
                  __typename
                }
                followers { totalCount __typename }
                roles { isPartner __typename }
                broadcastSettings { title __typename }
                __typename
              }
            }
            __typename
          }
          totalMatches
          __typename
        }
        __typename
      }
    }
  `;

  type LoadMoreData = {
    searchFor: null | {
      channels: null | {
        cursor: string | null;
        edges: { trackingID: string; item: SearchChannelEdgeItem; __typename: string }[];
        totalMatches: number;
      };
    };
  };

  // `first` and `after` are not honored by this connection — kept on the
  // function signature so callers (and the cursor-no-advance guard) treat the
  // result like a paginated response. The cursor-no-advance guard in
  // gqlSearchChannels detects that Twitch ignored `after` and reports
  // end-of-list, which keeps the dropdown's near-bottom scroll handler from
  // looping fetchNextPage forever.
  void first;

  const [response] = (await gqlRequest([
    getRawQuery<LoadMoreData>({ query: rawQuery, variables: { query, platform: "web" } }),
  ])) as [{ data?: LoadMoreData; errors?: { message: string }[] }];

  // After param is intentionally not sent — server doesn't accept it on this
  // connection — but we still pass it through so the cursor-no-advance guard
  // can compare server cursor against it.
  void after;

  const channelsConn = response.data?.searchFor?.channels;
  const channels = (channelsConn?.edges ?? []).map((edge) => transformSearchChannel(edge.item));
  const returnedCursor = channelsConn?.cursor || undefined;

  return { data: channels, cursor: returnedCursor, errors: response.errors };
}

/**
 * Search for channels via GQL.
 *
 * Page 1 uses the bundled `SearchResultsPage_SearchResults` persisted query
 * (known-good for anonymous reads). Page 2+ uses a raw GQL LoadMore query
 * because the persisted op ignores cursor input.
 *
 * Three guards prevent the dropdown's near-bottom scroll handler from looping
 * fetchNextPage forever:
 * - Cursor-no-advance: server returns the same cursor we sent → end-of-list.
 * - Integrity-check rejection: anonymous paginated raw query was rejected → end-of-list.
 * - Empty page: no edges returned → end-of-list.
 */
export async function gqlSearchChannels(
  query: string,
  options: PaginationOptions & { liveOnly?: boolean } = {}
): Promise<PaginatedResult<UnifiedChannel>> {
  let channels: UnifiedChannel[];
  let returnedCursor: string | undefined;
  let errors: { message: string }[] | undefined;

  if (options.after) {
    const result = await gqlSearchChannelsLoadMore(query, options.after, options.first);
    channels = result.data;
    returnedCursor = result.cursor;
    errors = result.errors;
  } else {
    const variables: Record<string, unknown> = {
      query,
      includeIsDJ: false,
    };
    if (options.first) variables.first = options.first;

    const [response] = (await gqlRequest([
      getQuerySearchResultsPageSearchResults(
        variables as unknown as Parameters<typeof getQuerySearchResultsPageSearchResults>[0]
      ),
    ])) as [{ data?: SearchResultsPageSearchResultsData; errors?: { message: string }[] }];

    const searchData = response.data?.searchFor;
    channels = (searchData?.channels.edges ?? []).map((edge) => transformSearchChannel(edge.item));
    returnedCursor = searchData?.channels.cursor || undefined;
    errors = response.errors;
  }

  if (options.liveOnly) {
    channels = channels.filter((ch) => ch.isLive);
  }

  const { isIntegrityRejected } = processGqlSearchErrors("SearchChannels", errors);

  const cursorAdvanced =
    !isIntegrityRejected &&
    !!returnedCursor &&
    returnedCursor !== options.after &&
    channels.length > 0;

  return {
    data: channels,
    cursor: cursorAdvanced ? returnedCursor : undefined,
  };
}

type SearchGameEdgeItem =
  SearchResultsPageSearchResultsData["searchFor"]["games"]["edges"][number]["item"];

function transformSearchGame(game: SearchGameEdgeItem): UnifiedCategory {
  return {
    id: game.id,
    platform: "twitch" as const,
    name: game.displayName || game.name,
    boxArtUrl: game.boxArtURL.replace("{width}", "285").replace("{height}", "380"),
    viewerCount: game.viewersCount ?? undefined,
  };
}

/**
 * Raw-GQL LoadMore for categories — used only on page 2+ (when `after` is set).
 * Mirrors gqlSearchChannelsLoadMore against the games connection.
 */
async function gqlSearchCategoriesLoadMore(
  query: string,
  after: string,
  first: number | undefined
): Promise<{
  data: UnifiedCategory[];
  cursor: string | undefined;
  errors?: { message: string }[];
}> {
  // Same schema constraints as gqlSearchChannelsLoadMore — see comment there.
  const rawQuery = `
    query SearchResultsPageLoadMoreGames($query: String!, $platform: String!) {
      searchFor(userQuery: $query, platform: $platform, options: {targets: [{index: GAME}]}) {
        games {
          cursor
          edges {
            trackingID
            item {
              ... on Game {
                id
                name
                displayName
                boxArtURL
                viewersCount
                __typename
              }
            }
            __typename
          }
          totalMatches
          __typename
        }
        __typename
      }
    }
  `;

  type LoadMoreData = {
    searchFor: null | {
      games: null | {
        cursor: string | null;
        edges: { trackingID: string; item: SearchGameEdgeItem; __typename: string }[];
        totalMatches: number;
      };
    };
  };

  void first;
  void after;

  const [response] = (await gqlRequest([
    getRawQuery<LoadMoreData>({ query: rawQuery, variables: { query, platform: "web" } }),
  ])) as [{ data?: LoadMoreData; errors?: { message: string }[] }];

  const gamesConn = response.data?.searchFor?.games;
  const categories = (gamesConn?.edges ?? []).map((edge) => transformSearchGame(edge.item));
  const returnedCursor = gamesConn?.cursor || undefined;

  return { data: categories, cursor: returnedCursor, errors: response.errors };
}

/**
 * Search for categories via GQL. Same pagination shape as `gqlSearchChannels`:
 * page 1 via persisted query, page 2+ via raw-GQL LoadMore, three guards.
 */
export async function gqlSearchCategories(
  query: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  let categories: UnifiedCategory[];
  let returnedCursor: string | undefined;
  let errors: { message: string }[] | undefined;

  if (options.after) {
    const result = await gqlSearchCategoriesLoadMore(query, options.after, options.first);
    categories = result.data;
    returnedCursor = result.cursor;
    errors = result.errors;
  } else {
    const variables: Record<string, unknown> = {
      query,
      options: { targets: [{ index: "GAME" }] },
      includeIsDJ: false,
    };
    if (options.first) variables.first = options.first;

    const [response] = (await gqlRequest([
      getQuerySearchResultsPageSearchResults(
        variables as unknown as Parameters<typeof getQuerySearchResultsPageSearchResults>[0]
      ),
    ])) as [{ data?: SearchResultsPageSearchResultsData; errors?: { message: string }[] }];

    const searchData = response.data?.searchFor;
    categories = (searchData?.games.edges ?? []).map((edge) => transformSearchGame(edge.item));
    returnedCursor = searchData?.games.cursor || undefined;
    errors = response.errors;
  }

  const { isIntegrityRejected } = processGqlSearchErrors("SearchCategories", errors);

  const cursorAdvanced =
    !isIntegrityRejected &&
    !!returnedCursor &&
    returnedCursor !== options.after &&
    categories.length > 0;

  return {
    data: categories,
    cursor: cursorAdvanced ? returnedCursor : undefined,
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
