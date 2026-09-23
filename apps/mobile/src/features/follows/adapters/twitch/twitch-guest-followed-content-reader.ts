import {
  toSerializedTimestamp,
  type Channel,
  type Clip,
  type SerializedTimestamp,
  type Stream,
  type Video,
} from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";
import type {
  FollowedClipPeriod,
  FollowedIdentityRef,
  FollowedRecordedSort,
} from "@streamfusion/core/relay";

import {
  canonicalTimestamp,
  numberField,
  stringField,
} from "@mobile/features/discovery/utils/helix-media";
import { requestInit } from "../../utils/following-query";
import type {
  FollowedContentReader,
  FollowedReadOutcome,
  FollowedRecordedOutcome,
} from "../../capabilities/following-session";
import { failedRead, failedRecorded } from "../relay/followed-content-parse";

const GQL = "https://gql.twitch.tv/gql";
const CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const FALLBACK_TIMESTAMP = toSerializedTimestamp("1970-01-01T00:00:00.000Z");
const STREAM_FIELDS =
  "id title viewersCount previewImageURL(width: 440, height: 248) freeformTags { name } createdAt broadcaster { id login displayName profileImageURL(width: 70) roles { isPartner } } game { id name displayName }";
const USER_LIVE_QUERY =
  "query FollowedUserLive($login: String!) { user(login: $login) { id login displayName profileImageURL(width: 70) description roles { isPartner isAffiliate } stream { " +
  STREAM_FIELDS +
  " } } }";
const USER_BY_ID_QUERY =
  "query FollowedUserById($id: ID!) { user(id: $id) { id login displayName profileImageURL(width: 70) description roles { isPartner isAffiliate } stream { " +
  STREAM_FIELDS +
  " } } }";
const VIDEO_QUERY =
  "query FilterableVideoTower_Videos($limit:Int!,$login:String!,$broadcastType:BroadcastType,$videoSort:VideoSort){user(login:$login){id login displayName profileImageURL(width:70) videos(first:$limit,type:$broadcastType,sort:$videoSort){edges{node{id title lengthSeconds viewCount publishedAt previewThumbnailURL broadcastType owner{id login displayName profileImageURL(width:70)}}}}}}";
const CLIP_QUERY =
  "query ClipsCards__User($login:String!,$limit:Int!,$criteria:ClipsFilter){user(login:$login){id login displayName profileImageURL(width:70) clips(first:$limit,criteria:{filter:$criteria}){edges{node{id slug title viewCount durationSeconds createdAt thumbnailURL url broadcaster{id login displayName profileImageURL(width:70)} curator{displayName}}}}}}";

/**
 * Desktop-parity guest Twitch followed-content path: public GQL Client-Id only.
 * Expo Go / signed-out Following must not depend on relay installation identity.
 */
export function createTwitchGuestFollowedContentReader(input: {
  readonly fetch: typeof globalThis.fetch;
}): FollowedContentReader {
  return {
    async readStreams(read) {
      if (read.platform !== "twitch") return failedRead(read.platform);
      if (read.signal?.aborted) return failedRead("twitch", true);
      const refs = uniqueRefs(read.refs);
      const pages = await Promise.all(
        refs.map((ref) => loadUser(input.fetch, ref, read.signal)),
      );
      if (pages.some((page) => page.kind === "failed")) {
        return failedRead("twitch");
      }
      const streams: Stream[] = [];
      const missing: FollowedIdentityRef[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const ref = refs[index];
        if (page?.kind !== "ready" || ref === undefined) continue;
        if (page.stream === null) {
          missing.push(ref);
          continue;
        }
        streams.push(page.stream);
      }
      return completeRead("twitch", streams, missing);
    },
    async readChannels(read) {
      if (read.platform !== "twitch") return failedRead(read.platform);
      if (read.signal?.aborted) return failedRead("twitch", true);
      const refs = uniqueRefs(read.refs);
      const pages = await Promise.all(
        refs.map((ref) => loadUser(input.fetch, ref, read.signal)),
      );
      if (pages.some((page) => page.kind === "failed")) {
        return failedRead("twitch");
      }
      const channels: Channel[] = [];
      const missing: FollowedIdentityRef[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const ref = refs[index];
        if (page?.kind !== "ready" || ref === undefined) continue;
        if (page.channel === null) {
          missing.push(ref);
          continue;
        }
        channels.push(page.channel);
      }
      return completeRead("twitch", channels, missing);
    },
    async readVideos(read) {
      if (read.platform !== "twitch") {
        return failedRecorded(read.platform, read.channelId);
      }
      const login = await resolveLogin(input.fetch, read, read.signal);
      if (login === null) {
        return failedRecorded("twitch", read.channelId);
      }
      const payload = await gqlJson(input.fetch, VIDEO_QUERY, {
        broadcastType: "ARCHIVE",
        limit: 20,
        login,
        videoSort: read.sort === "views" ? "VIEWS" : "TIME",
      }, read.signal);
      if (payload.kind === "failed") {
        return failedRecorded("twitch", read.channelId);
      }
      return {
        channelId: read.channelId,
        failed: false,
        items: videosFromPayload(payload.value),
        offline: false,
        platform: "twitch",
        stale: false,
        supported: true,
      };
    },
    async readClips(read) {
      if (read.platform !== "twitch") {
        return failedRecorded(read.platform, read.channelId);
      }
      const login = await resolveLogin(input.fetch, read, read.signal);
      if (login === null) {
        return failedRecorded("twitch", read.channelId);
      }
      const payload = await gqlJson(input.fetch, CLIP_QUERY, {
        criteria: clipCriteria(read.period),
        limit: 20,
        login,
      }, read.signal);
      if (payload.kind === "failed") {
        return failedRecorded("twitch", read.channelId);
      }
      const clips = [...clipsFromPayload(payload.value)].sort((left, right) =>
        read.sort === "views"
          ? right.viewCount - left.viewCount
          : right.createdAt.localeCompare(left.createdAt),
      );
      return {
        channelId: read.channelId,
        failed: false,
        items: clips,
        offline: false,
        platform: "twitch",
        stale: false,
        supported: true,
      };
    },
  };
}

async function resolveLogin(
  fetchImpl: typeof globalThis.fetch,
  read: {
    readonly channelId: string;
    readonly channelLogin?: string;
    readonly signal?: AbortSignal;
  },
  signal?: AbortSignal,
): Promise<string | null> {
  const known = read.channelLogin?.trim().toLowerCase();
  if (known) return known;
  const page = await loadUser(
    fetchImpl,
    { kind: "id", value: read.channelId },
    signal ?? read.signal,
  );
  return page.kind === "ready" ? page.channel?.username ?? null : null;
}

async function loadUser(
  fetchImpl: typeof globalThis.fetch,
  ref: FollowedIdentityRef,
  signal?: AbortSignal,
): Promise<
  | {
      readonly kind: "ready";
      readonly channel: Channel | null;
      readonly stream: Stream | null;
    }
  | { readonly kind: "failed" }
> {
  const payload =
    ref.kind === "login"
      ? await gqlJson(fetchImpl, USER_LIVE_QUERY, { login: ref.value }, signal)
      : await gqlJson(fetchImpl, USER_BY_ID_QUERY, { id: ref.value }, signal);
  if (payload.kind === "failed") return { kind: "failed" };
  const user = asRecord(dataRecord(payload.value)?.user);
  if (user === null) {
    return { channel: null, kind: "ready", stream: null };
  }
  const channel = channelFromUser(user);
  const streamNode = asRecord(user.stream);
  return {
    channel,
    kind: "ready",
    stream:
      channel === null || streamNode === null
        ? null
        : streamFromUser(streamNode, channel),
  };
}

async function gqlJson(
  fetchImpl: typeof globalThis.fetch,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<
  | { readonly kind: "ready"; readonly value: unknown }
  | { readonly kind: "failed" }
> {
  if (signal?.aborted) return { kind: "failed" };
  try {
    const response = await fetchImpl(GQL, {
      ...requestInit(
        {
          "Client-Id": CLIENT_ID,
          "Content-Type": "application/json",
        },
        signal,
      ),
      body: JSON.stringify({ query, variables }),
      method: "POST",
    });
    if (!response.ok) return { kind: "failed" };
    return { kind: "ready", value: await response.json() };
  } catch {
    return { kind: "failed" };
  }
}

function uniqueRefs(
  refs: readonly FollowedIdentityRef[],
): readonly FollowedIdentityRef[] {
  const seen = new Set<string>();
  const out: FollowedIdentityRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function completeRead<T>(
  platform: Platform,
  items: readonly T[],
  missing: readonly FollowedIdentityRef[],
): FollowedReadOutcome<T> {
  return {
    items,
    missing,
    offline: false,
    platform,
    retryable: false,
    stale: false,
    status: "complete",
  };
}

function clipCriteria(period: FollowedClipPeriod): string {
  if (period === "day") return "LAST_DAY";
  if (period === "week") return "LAST_WEEK";
  if (period === "month") return "LAST_MONTH";
  return "ALL_TIME";
}

function channelFromUser(user: Record<string, unknown>): Channel | null {
  const username = stringField(user, "login");
  const id = stringField(user, "id") || username;
  if (id === "" || username === "") return null;
  const bio = stringField(user, "description");
  const roles = asRecord(user.roles);
  return {
    avatarUrl: stringField(user, "profileImageURL"),
    displayName: stringField(user, "displayName") || username,
    id,
    isLive: asRecord(user.stream) !== null,
    isPartner: roles?.isPartner === true,
    isVerified: roles?.isPartner === true || roles?.isAffiliate === true,
    platform: "twitch",
    username,
    ...(bio === "" ? {} : { bio }),
  };
}

function streamFromUser(
  node: Record<string, unknown>,
  channel: Channel,
): Stream | null {
  const id = stringField(node, "id");
  if (id === "") return null;
  const game = asRecord(node.game);
  const startedAt = stringField(node, "createdAt");
  return {
    channelAvatar: channel.avatarUrl,
    channelDisplayName: channel.displayName,
    channelId: channel.id,
    channelName: channel.username,
    id,
    isLive: true,
    language: "",
    platform: "twitch",
    startedAt: startedAt === "" ? null : mediaTimestamp(startedAt),
    tags: [],
    thumbnailUrl: stringField(node, "previewImageURL"),
    title: stringField(node, "title"),
    viewerCount: numberField(node, "viewersCount"),
    ...(channel.isPartner ? { channelIsVerified: true } : {}),
    ...(game === null
      ? {}
      : {
          categoryId: stringField(game, "id"),
          categoryName:
            stringField(game, "displayName") || stringField(game, "name"),
        }),
  };
}

function videosFromPayload(value: unknown): readonly Video[] {
  const user = asRecord(dataRecord(value)?.user);
  if (user === null) return [];
  return edges(asRecord(user.videos)).flatMap((node) => {
    const id = stringField(node, "id");
    const title = stringField(node, "title");
    if (id === "" || title === "") return [];
    const owner = asRecord(node.owner) ?? user;
    const login = stringField(owner, "login");
    return [
      {
        channelAvatar: stringField(owner, "profileImageURL"),
        channelDisplayName: stringField(owner, "displayName") || login,
        channelId: stringField(owner, "id") || stringField(user, "id"),
        channelName: login,
        duration: numberField(node, "lengthSeconds"),
        id,
        platform: "twitch" as const,
        publishedAt: mediaTimestamp(stringField(node, "publishedAt")),
        thumbnailUrl: stringField(node, "previewThumbnailURL"),
        title,
        type: "archive" as const,
        url: `https://www.twitch.tv/videos/${id}`,
        viewCount: numberField(node, "viewCount"),
      },
    ];
  });
}

function clipsFromPayload(value: unknown): readonly Clip[] {
  const user = asRecord(dataRecord(value)?.user);
  if (user === null) return [];
  return edges(asRecord(user.clips)).flatMap((node) => {
    const id = stringField(node, "slug") || stringField(node, "id");
    const title = stringField(node, "title");
    if (id === "" || title === "") return [];
    const broadcaster = asRecord(node.broadcaster) ?? user;
    const curator = asRecord(node.curator);
    return [
      {
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
        platform: "twitch" as const,
        thumbnailUrl: stringField(node, "thumbnailURL"),
        title,
        viewCount: numberField(node, "viewCount"),
      },
    ];
  });
}

function edges(
  value: Record<string, unknown> | null,
): readonly Record<string, unknown>[] {
  if (value === null || !Array.isArray(value.edges)) return [];
  return value.edges.flatMap((edge) => {
    const node = asRecord(asRecord(edge)?.node);
    return node === null ? [] : [node];
  });
}

function mediaTimestamp(value: string): SerializedTimestamp {
  return canonicalTimestamp(value) ?? FALLBACK_TIMESTAMP;
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  const root = asRecord(value);
  return root === null ? null : (asRecord(root.data) ?? root);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
