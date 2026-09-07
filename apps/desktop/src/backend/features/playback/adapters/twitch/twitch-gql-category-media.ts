import { z } from "zod";
import { getRawQuery } from "twitch-gql-queries";
import { gqlRequest } from "@backend/api/platforms/twitch/twitch-gql-client";
import type { UnifiedClip, UnifiedVideo } from "@shared/platform-types";
import type {
  CategoryClipOptions,
  CategoryContentOptions,
  PageResult,
} from "@streamfusion/core/discovery";

const ownerSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  displayName: z.string(),
  profileImageURL: z.string(),
});
const gameSchema = z.object({ id: z.string().min(1), name: z.string() });
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const videoSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  lengthSeconds: z.number().nonnegative(),
  viewCount: z.number().nonnegative(),
  publishedAt: z.string(),
  previewThumbnailURL: z.string(),
  status: z.enum(["RECORDED", "RECORDING"]),
  broadcastType: z.enum(["ARCHIVE", "HIGHLIGHT", "UPLOAD"]),
  language: z.string(),
  owner: ownerSchema,
  game: gameSchema.nullable(),
});
const clipSchema = z.object({
  slug: z.string().min(1),
  title: z.string(),
  durationSeconds: z.number().nonnegative(),
  viewCount: z.number().nonnegative(),
  createdAt: z.string(),
  thumbnailURL: z.string(),
  language: z.string(),
  broadcaster: ownerSchema,
  curator: z.object({ displayName: z.string() }).nullable(),
  game: gameSchema.nullable(),
});
function connectionSchema<T extends z.ZodType>(node: T) {
  return z.object({
    edges: z.array(z.object({ cursor: z.string().nullable(), node })),
    pageInfo: pageInfoSchema,
  });
}
const videosSchema = z.object({
  game: gameSchema.extend({ videos: connectionSchema(videoSchema) }).nullable(),
});
const clipsSchema = z.object({
  game: gameSchema.extend({ clips: connectionSchema(clipSchema) }).nullable(),
});

const VIDEO_QUERY = `query CategoryVideos($id: ID!, $first: Int!, $after: Cursor, $sort: VideoSort, $languages: [String!]) {
  game(id: $id) {
    id name
    videos(first: $first, after: $after, sort: $sort, languages: $languages) {
      edges { cursor node {
        id title lengthSeconds viewCount publishedAt previewThumbnailURL(width: 320, height: 180)
        status broadcastType language
        owner { id login displayName profileImageURL(width: 70) }
        game { id name }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const CLIP_QUERY = `query CategoryClips($id: ID!, $first: Int!, $after: Cursor, $filter: ClipsFilter, $languages: [Language!]) {
  game(id: $id) {
    id name
    clips(first: $first, after: $after, criteria: { filter: $filter, languages: $languages }) {
      edges { cursor node {
        slug title durationSeconds viewCount createdAt thumbnailURL language
        broadcaster { id login displayName profileImageURL(width: 70) }
        curator { displayName }
        game { id name }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

async function request(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const [response] = await gqlRequest([getRawQuery<unknown>({ query, variables })]);
  if (response.errors?.length)
    throw new Error(response.errors.map((error) => error.message).join("; "));
  return response.data;
}
function cursorFor(
  connection: { edges: { cursor: string | null }[]; pageInfo: z.infer<typeof pageInfoSchema> },
  previous?: string
) {
  if (!connection.pageInfo.hasNextPage) return undefined;
  const cursor = connection.pageInfo.endCursor ?? connection.edges.at(-1)?.cursor;
  if (!cursor || cursor === previous)
    throw new Error("Twitch category media returned a non-advancing page cursor.");
  return cursor;
}

export async function gqlGetCategoryVideos(
  categoryId: string,
  options: CategoryContentOptions = {}
): Promise<PageResult<UnifiedVideo>> {
  const { game } = videosSchema.parse(
    await request(VIDEO_QUERY, {
      id: categoryId,
      first: Math.min(Math.max(options.limit ?? 60, 1), 100),
      after: options.cursor ?? null,
      sort: options.sort === "popular" ? "VIEWS" : "TIME",
      languages: options.language ? [options.language.toLowerCase()] : [],
    })
  );
  if (!game) throw new Error("Twitch category was not found.");
  return {
    data: game.videos.edges
      .filter(({ node }) => node.status === "RECORDED")
      .map(({ node }): UnifiedVideo => ({
        id: node.id,
        platform: "twitch",
        title: node.title,
        channelId: node.owner.id,
        channelName: node.owner.login,
        channelDisplayName: node.owner.displayName,
        channelAvatar: node.owner.profileImageURL,
        thumbnailUrl: node.previewThumbnailURL,
        duration: node.lengthSeconds,
        viewCount: node.viewCount,
        publishedAt: node.publishedAt,
        url: `https://www.twitch.tv/videos/${node.id}`,
        shareUrl: `https://www.twitch.tv/videos/${node.id}`,
        type:
          node.broadcastType === "HIGHLIGHT"
            ? "highlight"
            : node.broadcastType === "UPLOAD"
              ? "upload"
              : "archive",
        categoryId: node.game?.id ?? game.id,
        categoryName: node.game?.name ?? game.name,
        language: node.language,
        isLive: false,
      })),
    cursor: cursorFor(game.videos, options.cursor),
  };
}

export async function gqlGetCategoryClips(
  categoryId: string,
  options: CategoryClipOptions = {}
): Promise<PageResult<UnifiedClip>> {
  const periods = {
    day: "LAST_DAY",
    week: "LAST_WEEK",
    month: "LAST_MONTH",
    all: "ALL_TIME",
  } as const;
  const { game } = clipsSchema.parse(
    await request(CLIP_QUERY, {
      id: categoryId,
      first: Math.min(Math.max(options.limit ?? 20, 1), 100),
      after: options.cursor ?? null,
      filter: periods[options.timeRange ?? "all"],
      languages: options.language ? [options.language.toUpperCase()] : [],
    })
  );
  if (!game) throw new Error("Twitch category was not found.");
  return {
    data: game.clips.edges.map(({ node }): UnifiedClip => ({
      id: node.slug,
      platform: "twitch",
      title: node.title,
      channelId: node.broadcaster.id,
      channelName: node.broadcaster.login,
      channelDisplayName: node.broadcaster.displayName,
      channelAvatar: node.broadcaster.profileImageURL,
      thumbnailUrl: node.thumbnailURL,
      duration: node.durationSeconds,
      viewCount: node.viewCount,
      createdAt: node.createdAt,
      clipUrl: `https://clips.twitch.tv/${node.slug}`,
      shareUrl: `https://clips.twitch.tv/${node.slug}`,
      embedUrl: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(node.slug)}`,
      creatorName: node.curator?.displayName ?? "",
      gameId: node.game?.id ?? game.id,
      gameName: node.game?.name ?? game.name,
      categoryId: node.game?.id ?? game.id,
      categoryName: node.game?.name ?? game.name,
      language: node.language.toLowerCase(),
    })),
    cursor: cursorFor(game.clips, options.cursor),
  };
}
