import {
  toSerializedTimestamp,
  type Clip,
  type SerializedTimestamp,
  type Video,
} from "@streamfusion/core/content";

import type {
  PlatformReadOutcome,
  PlatformReadPath,
} from "../../capabilities/platform-reads";
import {
  canonicalTimestamp,
  numberField,
  stringField,
} from "../../utils/helix-media";
import { requestInit } from "../../utils/optional";

const GQL = "https://gql.twitch.tv/gql";
const CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const FALLBACK_TIMESTAMP = toSerializedTimestamp("1970-01-01T00:00:00.000Z");
const VIDEO_QUERY =
  "query FilterableVideoTower_Videos($limit:Int!,$login:String!,$broadcastType:BroadcastType,$videoSort:VideoSort){user(login:$login){id login displayName profileImageURL(width:70) videos(first:$limit,type:$broadcastType,sort:$videoSort){edges{node{id title lengthSeconds viewCount publishedAt previewThumbnailURL broadcastType owner{id login displayName profileImageURL(width:70)}}}}}}";
const CLIP_QUERY =
  "query ClipsCards__User($login:String!,$limit:Int!,$criteria:ClipsFilter){user(login:$login){id login displayName profileImageURL(width:70) clips(first:$limit,criteria:{filter:$criteria}){edges{node{id slug title viewCount durationSeconds createdAt thumbnailURL url broadcaster{id login displayName profileImageURL(width:70)} curator{displayName}}}}}}";

export function createTwitchGqlGuestMediaReader(input: {
  readonly fetch: typeof globalThis.fetch;
}) {
  return {
    async getChannelVideos(read: {
      readonly login: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Video>> {
      return gqlMedia({
        fetchImpl: input.fetch,
        map: videosFromPayload,
        query: VIDEO_QUERY,
        variables: {
          broadcastType: "ARCHIVE",
          limit: 20,
          login: read.login,
          videoSort: "TIME",
        },
        ...signalProp(read.signal),
      });
    },
    async getChannelClips(read: {
      readonly login: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Clip>> {
      return gqlMedia({
        fetchImpl: input.fetch,
        map: clipsFromPayload,
        query: CLIP_QUERY,
        variables: { criteria: "LAST_MONTH", limit: 20, login: read.login },
        ...signalProp(read.signal),
      });
    },
  };
}

async function gqlMedia<T>(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly map: (value: unknown) => readonly T[];
  readonly query: string;
  readonly signal?: AbortSignal;
  readonly variables: Record<string, unknown>;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return failed("cancelled");
  try {
    const response = await input.fetchImpl(GQL, {
      ...requestInit(
        {
          "Client-Id": CLIENT_ID,
          "Content-Type": "application/json",
        },
        input.signal,
      ),
      body: JSON.stringify({ query: input.query, variables: input.variables }),
      method: "POST",
    });
    if (!response.ok) {
      return failed(response.status === 401 ? "auth-lost" : "twitch-failed");
    }
    return {
      cache: { kind: "miss" },
      items: input.map(await response.json()),
      path: { kind: "guest", platform: "twitch" },
      platform: "twitch",
      status: "complete",
    };
  } catch {
    return failed(input.signal?.aborted ? "cancelled" : "twitch-failed");
  }
}

function videosFromPayload(value: unknown): readonly Video[] {
  const user = userFrom(value);
  if (user === undefined) return [];
  return edges(asRecord(user.videos)).flatMap((node) => {
    const video = videoFromNode(node, user);
    return video === undefined ? [] : [video];
  });
}

function clipsFromPayload(value: unknown): readonly Clip[] {
  const user = userFrom(value);
  if (user === undefined) return [];
  return edges(asRecord(user.clips)).flatMap((node) => {
    const clip = clipFromNode(node, user);
    return clip === undefined ? [] : [clip];
  });
}

function videoFromNode(
  node: Record<string, unknown>,
  user: Record<string, unknown>,
): Video | undefined {
  const id = stringField(node, "id");
  const title = stringField(node, "title");
  if (id === "" || title === "") return undefined;
  const owner = asRecord(node.owner) ?? user;
  const login = stringField(owner, "login");
  return {
    channelAvatar: stringField(owner, "profileImageURL"),
    channelDisplayName: stringField(owner, "displayName") || login,
    channelId: stringField(owner, "id") || stringField(user, "id"),
    channelName: login,
    duration: numberField(node, "lengthSeconds"),
    id,
    platform: "twitch",
    publishedAt: mediaTimestamp(stringField(node, "publishedAt")),
    thumbnailUrl: stringField(node, "previewThumbnailURL"),
    title,
    type: "archive",
    url: `https://www.twitch.tv/videos/${id}`,
    viewCount: numberField(node, "viewCount"),
  };
}

function clipFromNode(
  node: Record<string, unknown>,
  user: Record<string, unknown>,
): Clip | undefined {
  const id = stringField(node, "slug") || stringField(node, "id");
  const title = stringField(node, "title");
  if (id === "" || title === "") return undefined;
  const broadcaster = asRecord(node.broadcaster) ?? user;
  const curator = asRecord(node.curator);
  return {
    channelAvatar: stringField(broadcaster, "profileImageURL"),
    channelDisplayName:
      stringField(broadcaster, "displayName") ||
      stringField(broadcaster, "login"),
    channelId: stringField(broadcaster, "id") || stringField(user, "id"),
    channelName: stringField(broadcaster, "login"),
    clipUrl: stringField(node, "url") || `https://clips.twitch.tv/${id}`,
    createdAt: mediaTimestamp(stringField(node, "createdAt")),
    creatorName: curator
      ? stringField(curator, "displayName")
      : stringField(broadcaster, "displayName"),
    duration: numberField(node, "durationSeconds"),
    id,
    platform: "twitch",
    thumbnailUrl: stringField(node, "thumbnailURL"),
    title,
    viewCount: numberField(node, "viewCount"),
  };
}

function userFrom(value: unknown): Record<string, unknown> | undefined {
  const data = asRecord(asRecord(value)?.data);
  return data === undefined ? undefined : asRecord(data.user);
}

function edges(
  value: Record<string, unknown> | undefined,
): readonly Record<string, unknown>[] {
  if (value === undefined || !Array.isArray(value.edges)) return [];
  return value.edges.flatMap((edge) => {
    const node = isRecord(edge) ? asRecord(edge.node) : undefined;
    return node === undefined ? [] : [node];
  });
}

function mediaTimestamp(value: string): SerializedTimestamp {
  return canonicalTimestamp(value) ?? FALLBACK_TIMESTAMP;
}

function failed<T>(code: string): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path: failedPath(code),
    platform: "twitch",
    status: "failed",
  };
}

function failedPath(code: string): PlatformReadPath {
  if (code === "cancelled") {
    return { kind: "unavailable", platform: "twitch", reason: "cancelled" };
  }
  if (code === "auth-lost") {
    return { kind: "unavailable", platform: "twitch", reason: "auth-lost" };
  }
  return { kind: "guest", platform: "twitch" };
}

function signalProp(
  signal?: AbortSignal,
): { readonly signal: AbortSignal } | Record<string, never> {
  return signal === undefined ? {} : { signal };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
