import type { Clip, Video } from "@streamfusion/core/content";
import type { ClipTimeRange } from "@streamfusion/core/discovery";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import { canonicalTimestamp } from "../../utils/helix-media";
import { requestInit } from "../../utils/optional";

const GQL = "https://gql.twitch.tv/gql";
const CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const VIDEO_QUERY = `query CategoryVideos($id: ID!, $first: Int!, $sort: VideoSort) {
  game(id: $id) { id name videos(first: $first, sort: $sort) {
    edges { node {
      id title lengthSeconds viewCount publishedAt previewThumbnailURL(width: 320, height: 180)
      status broadcastType owner { id login displayName profileImageURL(width: 70) }
    } }
  } }
}`;
const CLIP_QUERY = `query CategoryClips($id: ID!, $first: Int!, $filter: ClipsFilter) {
  game(id: $id) { id name clips(first: $first, criteria: { filter: $filter }) {
    edges { node {
      slug title durationSeconds viewCount createdAt thumbnailURL
      broadcaster { id login displayName profileImageURL(width: 70) }
      curator { displayName }
    } }
  } }
}`;

export function createTwitchGqlCategoryMediaReader(input: {
  readonly fetch: typeof globalThis.fetch;
}) {
  return {
    getCategoryClips(read: {
      readonly categoryId: string;
      readonly signal?: AbortSignal;
      readonly timeRange: ClipTimeRange;
    }): Promise<PlatformReadOutcome<Clip>> {
      const periods: Record<ClipTimeRange, string> = {
        day: "LAST_DAY",
        week: "LAST_WEEK",
        month: "LAST_MONTH",
        all: "ALL_TIME",
      };
      return requestCategory({
        fetchImpl: input.fetch,
        map: clipsFromGame,
        query: CLIP_QUERY,
        variables: {
          id: read.categoryId,
          first: 20,
          filter: periods[read.timeRange],
        },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    getCategoryVideos(read: {
      readonly categoryId: string;
      readonly signal?: AbortSignal;
      readonly sort: "views" | "recent";
    }): Promise<PlatformReadOutcome<Video>> {
      return requestCategory({
        fetchImpl: input.fetch,
        map: videosFromGame,
        query: VIDEO_QUERY,
        variables: {
          id: read.categoryId,
          first: 60,
          sort: read.sort === "views" ? "VIEWS" : "TIME",
        },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
  };
}

async function requestCategory<T>(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly map: (game: Record<string, unknown>) => readonly T[];
  readonly query: string;
  readonly signal?: AbortSignal;
  readonly variables: Record<string, unknown>;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return failed("cancelled");
  try {
    const response = await input.fetchImpl(GQL, {
      ...requestInit(
        { "Client-Id": CLIENT_ID, "Content-Type": "application/json" },
        input.signal,
      ),
      body: JSON.stringify({ query: input.query, variables: input.variables }),
      method: "POST",
    });
    if (!response.ok) return failed("twitch-failed");
    const payload: unknown = await response.json();
    const envelope = record(payload);
    if (
      !envelope ||
      (envelope.errors !== undefined &&
        (!Array.isArray(envelope.errors) || envelope.errors.length > 0))
    ) {
      return failed("twitch-failed");
    }
    const game = record(record(envelope.data)?.game);
    if (!game) return failed("twitch-failed");
    return {
      cache: { kind: "miss" },
      items: input.map(game),
      path: { kind: "guest", platform: "twitch" },
      platform: "twitch",
      status: "complete",
    };
  } catch (error) {
    return failed(
      input.signal?.aborted || isAbort(error) ? "cancelled" : "twitch-failed",
    );
  }
}

function clipsFromGame(game: Record<string, unknown>): readonly Clip[] {
  const categoryId = requiredString(game, "id");
  const categoryName = requiredString(game, "name");
  return nodes(game, "clips").map((node): Clip => {
    const id = requiredString(node, "slug");
    const broadcaster = requiredRecord(node, "broadcaster");
    const curator =
      node.curator === null ? null : requiredRecord(node, "curator");
    return {
      id,
      platform: "twitch",
      title: requiredString(node, "title"),
      channelId: requiredString(broadcaster, "id"),
      channelName: requiredString(broadcaster, "login"),
      channelDisplayName: requiredString(broadcaster, "displayName"),
      channelAvatar: requiredString(broadcaster, "profileImageURL"),
      thumbnailUrl: requiredString(node, "thumbnailURL"),
      clipUrl: `https://clips.twitch.tv/${id}`,
      shareUrl: `https://clips.twitch.tv/${id}`,
      duration: requiredNumber(node, "durationSeconds"),
      viewCount: requiredNumber(node, "viewCount"),
      createdAt: requiredTimestamp(node, "createdAt"),
      creatorName:
        curator === null ? "" : requiredString(curator, "displayName"),
      categoryId,
      categoryName,
    };
  });
}

function videosFromGame(game: Record<string, unknown>): readonly Video[] {
  const categoryId = requiredString(game, "id");
  const categoryName = requiredString(game, "name");
  return nodes(game, "videos")
    .filter((node) => requiredString(node, "status") === "RECORDED")
    .map((node): Video => {
      const id = requiredString(node, "id");
      const owner = requiredRecord(node, "owner");
      const broadcastType = requiredString(node, "broadcastType");
      if (
        broadcastType !== "ARCHIVE" &&
        broadcastType !== "HIGHLIGHT" &&
        broadcastType !== "UPLOAD"
      ) {
        throw new Error("Invalid Twitch video type");
      }
      return {
        id,
        platform: "twitch",
        title: requiredString(node, "title"),
        channelId: requiredString(owner, "id"),
        channelName: requiredString(owner, "login"),
        channelDisplayName: requiredString(owner, "displayName"),
        channelAvatar: requiredString(owner, "profileImageURL"),
        thumbnailUrl: requiredString(node, "previewThumbnailURL"),
        duration: requiredNumber(node, "lengthSeconds"),
        viewCount: requiredNumber(node, "viewCount"),
        publishedAt: requiredTimestamp(node, "publishedAt"),
        url: `https://www.twitch.tv/videos/${id}`,
        shareUrl: `https://www.twitch.tv/videos/${id}`,
        type:
          broadcastType === "HIGHLIGHT"
            ? "highlight"
            : broadcastType === "UPLOAD"
              ? "upload"
              : "archive",
        categoryId,
        categoryName,
      };
    });
}

function nodes(
  game: Record<string, unknown>,
  key: string,
): readonly Record<string, unknown>[] {
  const connection = requiredRecord(game, key);
  if (!Array.isArray(connection.edges))
    throw new Error("Invalid Twitch media edges");
  return connection.edges.map((edge) =>
    requiredRecord(requiredRecordValue(edge), "node"),
  );
}

function requiredRecordValue(value: unknown): Record<string, unknown> {
  const result = record(value);
  if (!result) throw new Error("Invalid Twitch media record");
  return result;
}

function requiredRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return requiredRecordValue(value[key]);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Invalid Twitch media ${key}`);
  return field;
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field) || field < 0) {
    throw new Error(`Invalid Twitch media ${key}`);
  }
  return field;
}

function requiredTimestamp(value: Record<string, unknown>, key: string) {
  const timestamp = canonicalTimestamp(requiredString(value, key));
  if (!timestamp) throw new Error(`Invalid Twitch media ${key}`);
  return timestamp;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function failed<T>(code: string): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path:
      code === "cancelled"
        ? { kind: "unavailable", platform: "twitch", reason: "cancelled" }
        : { kind: "guest", platform: "twitch" },
    platform: "twitch",
    status: "failed",
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
