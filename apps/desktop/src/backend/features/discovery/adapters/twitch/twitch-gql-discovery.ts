import {
  type ChannelRootAboutPanelData,
  type ChannelShellData,
  type DirectoryPageGameStream,
  getQueryBowsePageAllDirectories,
  getQueryChannelRootAboutPanel,
  getQueryChannelShell,
  getQuerySearchResultsPageSearchResults,
  getQueryStreamMetadata,
  getQueryUseLive,
  getQueryUseViewCount,
  getRawQuery,
  type SearchResultsPageSearchResultsData,
  type StreamMetadataData,
  type UseLiveData,
  type UseViewCountData,
} from "twitch-gql-queries";
import { logger } from "@shared/utils/cross-logger";
import type { UnifiedCategory, UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import type {
  GqlError,
  PaginatedResult,
  PaginationOptions,
} from "@backend/api/platforms/twitch/twitch-types";
import {
  gqlRequest,
  sendPersistedQuery,
  MAX_QUERIES_PER_REQUEST,
} from "@backend/api/platforms/twitch/twitch-gql-client";

const MAX_CATEGORY_VIEWER_COUNT_IDS = 100;

/**
 * Helper to transform GQL stream data → UnifiedStream
 */
function extractLoginFromPreviewUrl(url: string): string {
  const match = /(?:^|\/)live_user_([a-z0-9_]+)(?:-[^/?#.]*)?\.[a-z0-9]+(?:[?#].*)?$/i.exec(url);
  return match?.[1] ?? "";
}

function transformGqlStream(
  stream: DirectoryPageGameStream,
  overrides: Partial<UnifiedStream> = {}
): UnifiedStream {
  const thumbnailUrl = stream.previewImageURL.replace("{width}", "440").replace("{height}", "248");
  const broadcaster = stream.broadcaster as
    (typeof stream.broadcaster & { roles?: { isPartner?: boolean } }) | undefined;
  const fallbackLogin = extractLoginFromPreviewUrl(thumbnailUrl);
  const channelName = broadcaster?.login || fallbackLogin;
  const channelDisplayName = broadcaster?.displayName || channelName;

  return {
    id: stream.id,
    platform: "twitch",
    channelId: broadcaster?.id || "",
    channelName,
    channelDisplayName,
    channelAvatar: broadcaster?.profileImageURL || "",
    channelIsVerified: !!broadcaster?.roles?.isPartner,
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

function onlyRoutableStreams(streams: UnifiedStream[]): UnifiedStream[] {
  return streams.filter((stream) => stream.channelName.trim().length > 0);
}

async function enrichRecoveredStreamMetadata(streams: UnifiedStream[]): Promise<UnifiedStream[]> {
  const enriched = await Promise.all(
    streams.map(async (stream): Promise<UnifiedStream | null> => {
      if (stream.channelId || !stream.channelName) return stream;

      try {
        const details = await gqlGetStreamByLogin(stream.channelName);
        if (!details) return null;

        return {
          ...stream,
          channelId: details.channelId || stream.channelId,
          channelDisplayName: details.channelDisplayName || stream.channelDisplayName,
          channelAvatar: details.channelAvatar || stream.channelAvatar,
          channelIsVerified: details.channelIsVerified ?? stream.channelIsVerified,
          title: details.title || stream.title,
          startedAt: details.startedAt || stream.startedAt,
          language: details.language || stream.language,
          tags: details.tags.length > 0 ? details.tags : stream.tags,
          categoryId: details.categoryId || stream.categoryId,
          categoryName: details.categoryName || stream.categoryName,
        };
      } catch (err) {
        logger.warn("Twitch:GQL", "failed to hydrate recovered stream metadata", {
          channelName: stream.channelName,
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
        return null;
      }
    })
  );

  return enriched.filter((stream): stream is UnifiedStream => stream !== null);
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
    logger.warn("Twitch:GQL", "gqlGetGameMetadata failed", {
      gameId,
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : String(err),
    });
    return null;
  }
}

/**
 * Fetch streams for a category via the `DirectoryPage_Game` persisted query
 * (same hash + variable shape Xtra uses). Persisted queries bypass the
 * integrity check that blocks paginated anonymous raw queries — which is why
 * this path scales past the ~100-stream wall the raw-query path hits.
 */
async function gqlGetGameStreamsBySlug(
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

  const streams = await enrichRecoveredStreamMetadata(
    onlyRoutableStreams(conn.edges.map((e) => transformGqlStream(e.node)))
  );
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
async function gqlGetStreamsByGameId(
  gameId: string,
  options: { first?: number; after?: string; language?: string; slug?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const slug = options.slug ?? (await resolveGameSlugById(gameId));
  if (slug) {
    try {
      return await gqlGetGameStreamsBySlug(slug, options);
    } catch (err) {
      logger.warn("Twitch:GQL", "DirectoryPage_Game persisted query failed, falling back to raw", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
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

  const [response] = await gqlRequest([
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
  ]);

  if (response.errors) {
    // "failed integrity check" is Twitch's expected response to paginated
    // anonymous raw queries (after: <cursor>). Treat it as end-of-stream
    // instead of logging noise.
    const messages = response.errors.map((error) => error.message).join(", ");
    if (!messages.includes("failed integrity check")) {
      logger.warn("Twitch:GQL", "GetStreamsByGameId query errors", { messages });
    }
  }

  const streamsConn = response.data?.game?.streams;
  if (!streamsConn) return { data: [] };

  const streams = await enrichRecoveredStreamMetadata(
    onlyRoutableStreams(streamsConn.edges.map((edge) => transformGqlStream(edge.node)))
  );
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
  const [response] = await gqlRequest([
    getRawQuery<TopStreamsData>({
      query,
      variables: {
        limit: Math.min(limit, 30),
        cursor: options.after || null,
      },
    }),
  ]);

  if (response.errors) {
    logger.warn("Twitch:GQL", "TopStreams query errors", {
      messages: response.errors.map((error) => error.message).join(", "),
    });
  }

  const data = response.data;
  if (!data?.streams) return { data: [] };

  let streams = await enrichRecoveredStreamMetadata(
    onlyRoutableStreams(data.streams.edges.map((edge) => transformGqlStream(edge.node)))
  );
  const language = options.language?.trim().toLowerCase();
  if (language) {
    const metadataByLogin = await getTagsAndLanguageByLogins(
      streams.map((stream) => stream.channelName)
    );
    streams = streams.map((stream) => {
      const metadata = metadataByLogin.get(stream.channelName);
      return metadata
        ? {
            ...stream,
            channelDisplayName: metadata.displayName || stream.channelDisplayName,
            language: metadata.language,
            tags: metadata.tags.length > 0 ? metadata.tags : stream.tags,
          }
        : stream;
    });
  }
  const languageScopedStreams = language
    ? streams.filter((stream) => stream.language.trim().toLowerCase() === language)
    : streams;

  const lastCursor = data.streams.edges[data.streams.edges.length - 1]?.cursor;
  return {
    data: languageScopedStreams,
    cursor: data.streams.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
  };
}

// Persisted StreamMetadata doesn't carry displayName, freeformTags, or
// broadcastSettings.language, so fetch them via a raw user(login:) side query.
const STREAM_TAGS_AND_LANGUAGE_QUERY = `query StreamTagsAndLanguage($login: String!) {
  user(login: $login) {
    displayName
    stream { freeformTags { id name } }
    broadcastSettings { language }
  }
}`;

type StreamTagsAndLanguageData = {
  user: null | {
    displayName: string | null;
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
  displayName: string;
} {
  const user = data?.user;
  const tags = user?.stream?.freeformTags?.map((t) => t.name) ?? [];
  // broadcastSettings.language is uppercase BCP-47 (e.g. "EN"); downstream code
  // expects lowercase to match Helix's "en".
  const language = (user?.broadcastSettings?.language ?? "").toLowerCase();
  return { tags, language, displayName: user?.displayName || "" };
}

async function getTagsAndLanguageByLogins(
  logins: string[]
): Promise<Map<string, { tags: string[]; language: string; displayName: string }>> {
  const result = new Map<string, { tags: string[]; language: string; displayName: string }>();
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
    logger.warn("Twitch:GQL", "getTagsAndLanguageByLogins failed", {
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : String(err),
    });
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
  const userWithRoles = user as typeof user & { roles?: { isPartner?: boolean } };
  const viewers = viewCount.data?.user?.stream?.viewersCount ?? 0;
  const { tags, language, displayName } = extractTagsAndLanguage(tagsLang.data);

  return {
    id: stream.id,
    platform: "twitch",
    channelId: user.id,
    channelName: login,
    channelDisplayName: displayName || login,
    channelAvatar: user.profileImageURL || "",
    channelIsVerified: !!userWithRoles.roles?.isPartner,
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
          const userWithRoles = user as typeof user & { roles?: { isPartner?: boolean } };

          results.push({
            id: user.stream.id,
            platform: "twitch",
            channelId: user.id,
            channelName: login,
            channelDisplayName: login,
            channelAvatar: user.profileImageURL || "",
            channelIsVerified: !!userWithRoles.roles?.isPartner,
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
        stream.channelDisplayName = extra.displayName || stream.channelName;
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

  const [response] = await gqlRequest([
    getQueryBowsePageAllDirectories({
      limit,
      options: {
        sort: "VIEWER_COUNT",
      },
      cursor: options.after || null,
    }),
  ]);

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
      logger.warn("Twitch:GQL", "Twitch GQL category fetch hit safety limit (5000)");
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

  const [response] = await gqlRequest([getRawQuery<GameByIdData>({ query, variables: { id } })]);

  if (response.errors) {
    logger.warn("Twitch:GQL", "GetGameById query errors", {
      messages: response.errors.map((error) => error.message).join(", "),
    });
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

type CategoryViewerCountGame = {
  id: string;
  viewersCount: number | null;
};

function isCategoryViewerCountGame(value: unknown): value is CategoryViewerCountGame {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "viewersCount" in value &&
    (value.viewersCount === null ||
      (typeof value.viewersCount === "number" && Number.isFinite(value.viewersCount)))
  );
}

/**
 * Fetch aggregate Twitch category viewer counts by exact game ID.
 * Uses one bounded raw GQL query to preserve Helix search ordering and cursor.
 */
export async function gqlGetCategoryViewerCountsByIds(
  ids: readonly string[]
): Promise<Record<string, number>> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(
    0,
    MAX_CATEGORY_VIEWER_COUNT_IDS
  );
  if (uniqueIds.length === 0) return {};

  const variableDefinitions = uniqueIds.map((_, index) => `$id${index}: ID!`).join(", ");
  const fields = uniqueIds
    .map((_, index) => `g${index}: game(id: $id${index}) { id viewersCount }`)
    .join("\n");
  const variables = Object.fromEntries(uniqueIds.map((id, index) => [`id${index}`, id]));
  const query = `query GetCategoryViewerCounts(${variableDefinitions}) {
    ${fields}
  }`;

  const [response] = await gqlRequest([getRawQuery<Record<string, unknown>>({ query, variables })]);
  if (response.errors) {
    logger.warn("Twitch:GQL", "GetCategoryViewerCounts query errors", {
      messages: response.errors.map((error) => error.message).join(", "),
    });
  }

  const counts: Record<string, number> = {};
  for (const game of Object.values(response.data ?? {})) {
    if (!isCategoryViewerCountGame(game)) continue;
    if (game.viewersCount === null || game.viewersCount < 0) continue;
    counts[game.id] = game.viewersCount;
  }
  return counts;
}

/**
 * Test whether a single GQL error is the integrity-rejection signal.
 *
 * Twitch's wording is inconsistent across endpoints and deploys, but every
 * integrity rejection co-occurs `integrity` with one of `check` / `failed` /
 * `rejected` in the message, OR carries an `extensions.code` containing
 * `INTEGRITY`. Bare substring `integrity` is too broad — it false-positives
 * on schema errors like `"Cannot query field 'clientIntegrity' on type 'User'"`
 * or `"Variable $integrityToken is not defined"`, which would silently kill
 * pagination AND short-circuit the dev `console.warn` for the real error.
 *
 * Variants this matches (verified against observed Twitch wordings):
 * - `"failed integrity check"`, `"Failed Integrity Check"`, `"FAILED_INTEGRITY_CHECK"`
 * - `"integrity check failed"`, `"integrity check rejected"`
 * - `{ message: "Bad Request", extensions: { code: "INTEGRITY_FAILED" } }`
 * - `{ message: "Forbidden", extensions: { code: "INTEGRITY_REJECTED" } }`
 *
 * Does NOT match: `"Cannot query field 'integrity' on ..."`, `"Variable $integrity ..."`.
 */
function isIntegrityRejectionError(err: GqlError): boolean {
  const code = err.extensions?.code ?? "";
  if (code.toUpperCase().includes("INTEGRITY")) return true;

  const msg = err.message.toLowerCase();
  if (!msg.includes("integrity")) return false;
  return msg.includes("check") || msg.includes("failed") || msg.includes("rejected");
}

/**
 * Classify a Twitch GQL response's `errors[]` array. Integrity rejection is
 * Twitch's expected response to anonymous paginated raw queries — treat it as
 * end-of-list rather than logging noise. Other errors get a `console.warn`
 * so dev sees them.
 *
 * Per-error classification means a mixed envelope (one integrity error AND
 * one unrelated error) still reports the unrelated one through `console.warn`
 * instead of silently swallowing it behind the integrity flag.
 */
function processGqlSearchErrors(
  context: string,
  errors: GqlError[] | undefined
): { isIntegrityRejected: boolean } {
  if (!errors || errors.length === 0) return { isIntegrityRejected: false };

  const integrityErrors = errors.filter(isIntegrityRejectionError);
  const otherErrors = errors.filter((e) => !isIntegrityRejectionError(e));

  if (otherErrors.length > 0) {
    logger.warn("Twitch:GQL", `${context} query errors`, {
      messages: otherErrors.map((e) => e.message).join(", "),
    });
  }

  return { isIntegrityRejected: integrityErrors.length > 0 };
}

// Narrowed to only the fields transformSearchChannel reads. The persisted
// op returns the full SearchResultsPageChannel (a superset), but the raw-GQL
// LoadMore inline fragment selects exactly this shape — declaring the
// narrowing explicitly keeps the LoadMore response type honest about what's
// actually fetched. Exported so test fixtures can satisfy the same contract.
export type SearchChannelEdgeItem = Pick<
  SearchResultsPageSearchResultsData["searchFor"]["channels"]["edges"][number]["item"],
  | "id"
  | "login"
  | "displayName"
  | "profileImageURL"
  | "description"
  | "stream"
  | "followers"
  | "roles"
  | "broadcastSettings"
>;

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
  // `_after` and `_first` are intentionally unused — kept on the signature
  // so callers treat this like a paginated helper and the cursor-no-advance
  // guard in gqlSearchChannels can compare server cursor against the
  // original input. Twitch's searchFor.channels connection doesn't accept
  // cursor or first as arguments (see comment below), so nothing useful
  // can be forwarded from these.
  _after: string,
  _first: number | undefined
): Promise<{ data: UnifiedChannel[]; cursor: string | undefined; errors?: GqlError[] }> {
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

  const [response] = await gqlRequest([
    getRawQuery<LoadMoreData>({ query: rawQuery, variables: { query, platform: "web" } }),
  ]);

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
    // `first` and `after` are deliberately not forwarded on page 1: the
    // persisted op resolves server-side by SHA and ignores variables not
    // declared in the persisted document, so injecting them is a no-op
    // that also disables type-checking on the call.
    const [response] = await gqlRequest([
      getQuerySearchResultsPageSearchResults({
        query,
        includeIsDJ: false,
      }),
    ]);

    const searchData = response.data?.searchFor;
    channels = (searchData?.channels?.edges ?? []).map((edge) => transformSearchChannel(edge.item));
    returnedCursor = searchData?.channels?.cursor || undefined;
    errors = response.errors;
  }

  if (options.liveOnly) {
    channels = channels.filter((ch) => ch.isLive);
  }

  const { isIntegrityRejected } = processGqlSearchErrors("SearchChannels", errors);

  return buildPaginatedResult(
    "SearchChannels",
    channels,
    returnedCursor,
    options.after,
    isIntegrityRejected
  );
}

/**
 * Apply the three loop-stop guards (integrity rejection, empty page,
 * cursor-no-advance) and tag the result with an `endReason` when the
 * cursor is dropped. Single seam keeps channels and categories in lock-
 * step, and makes the precedence visible: integrity > empty > exhausted >
 * no-advance.
 *
 * Each end-of-list branch emits a `console.debug` with the context label
 * and reason. Anyone debugging "why did pagination stop at page N?" gets
 * a footprint in the dev console without parsing the call stack — the
 * `endReason` field on the return is the durable signal, the log is the
 * ad-hoc one.
 */
function buildPaginatedResult<T>(
  context: string,
  data: T[],
  returnedCursor: string | undefined,
  inputCursor: string | undefined,
  isIntegrityRejected: boolean
): PaginatedResult<T> {
  if (isIntegrityRejected) {
    logger.debug("Twitch:GQL", `${context} end-of-list: integrity-rejected`);
    return { data, cursor: undefined, endReason: "integrity-rejected" };
  }
  if (data.length === 0) {
    logger.debug("Twitch:GQL", `${context} end-of-list: empty-page`);
    return { data, cursor: undefined, endReason: "empty-page" };
  }
  if (!returnedCursor) {
    logger.debug("Twitch:GQL", `${context} end-of-list: exhausted (server returned no cursor)`);
    return { data, cursor: undefined, endReason: "exhausted" };
  }
  if (returnedCursor === inputCursor) {
    logger.debug("Twitch:GQL", `${context} end-of-list: cursor-no-advance`, {
      returnedCursor,
    });
    return { data, cursor: undefined, endReason: "cursor-no-advance" };
  }
  return { data, cursor: returnedCursor };
}

// See SearchChannelEdgeItem note — the LoadMore inline fragment on Game
// selects only these fields, so the local narrowing matches reality.
// Exported so test fixtures can satisfy the same contract.
export type SearchGameEdgeItem = Pick<
  SearchResultsPageSearchResultsData["searchFor"]["games"]["edges"][number]["item"],
  "id" | "name" | "displayName" | "boxArtURL" | "viewersCount"
>;

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
  // See gqlSearchChannelsLoadMore — `_after` and `_first` are intentionally
  // unused but kept on the signature for caller symmetry with the
  // cursor-no-advance guard at the wrapper layer.
  _after: string,
  _first: number | undefined
): Promise<{
  data: UnifiedCategory[];
  cursor: string | undefined;
  errors?: GqlError[];
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

  const [response] = (await gqlRequest([
    getRawQuery<LoadMoreData>({ query: rawQuery, variables: { query, platform: "web" } }),
  ])) as [{ data?: LoadMoreData; errors?: GqlError[] }];

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
    // See note in gqlSearchChannels: persisted op ignores unlisted variables.
    const [response] = (await gqlRequest([
      getQuerySearchResultsPageSearchResults({
        query,
        options: { targets: [{ index: "GAME" }] },
        includeIsDJ: false,
      }),
    ])) as [{ data?: SearchResultsPageSearchResultsData; errors?: GqlError[] }];

    const searchData = response.data?.searchFor;
    categories = (searchData?.games?.edges ?? []).map((edge) => transformSearchGame(edge.item));
    returnedCursor = searchData?.games?.cursor || undefined;
    errors = response.errors;
  }

  const { isIntegrityRejected } = processGqlSearchErrors("SearchCategories", errors);

  return buildPaginatedResult(
    "SearchCategories",
    categories,
    returnedCursor,
    options.after,
    isIntegrityRejected
  );
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
    categoryId: about?.lastBroadcast?.game?.id,
    categoryName: about?.lastBroadcast?.game?.displayName,
    socialLinks: about?.channel?.socialMedias?.map((s) => ({
      platform: s.name,
      url: s.url,
    })),
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
