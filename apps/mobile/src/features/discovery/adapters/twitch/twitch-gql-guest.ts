import type { Category, Channel, Stream } from "@streamfusion/core/content";
import { rankProviderChannels } from "../../domain/search-catalog";

import type {
  ChannelPageOutcome,
  PlatformReadOutcome,
  SearchPageOutcome,
  SearchPageRequest,
  MobileSearchKind,
} from "../../capabilities/platform-reads";
import {
  gqlBroadcasterPartner,
  gqlBroadcasterVerified,
  gqlTags,
} from "../../utils/catalog-fields";
import { canonicalTimestamp } from "../../utils/helix-media";
import { requestInit } from "../../utils/optional";

const GQL = "https://gql.twitch.tv/gql";
const CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const STREAM_FIELDS = `id title viewersCount createdAt previewImageURL(width: 440, height: 248) freeformTags { name } broadcaster { id login displayName profileImageURL(width: 70) broadcastSettings { language } roles { isPartner isAffiliate } } game { id name slug }`;

export function createTwitchGqlGuestReader(input: {
  readonly fetch: typeof globalThis.fetch;
}) {
  return {
    async getTopStreams(
      read: {
        readonly cursor?: string;
        readonly language?: string;
        readonly signal?: AbortSignal;
      } = {},
    ): Promise<PlatformReadOutcome<Stream>> {
      const language = read.language?.trim().toLowerCase();
      const items: Stream[] = [];
      const seenStreamIds = new Set<string>();
      let cursor = read.cursor;
      for (let page = 0; page < (language ? 3 : 1); page += 1) {
        const outcome = await gqlCollection({
          fetchImpl: input.fetch,
          map: streamsFromPayload,
          nextCursor: topStreamsNextCursor,
          query:
            "query GetTopStreams($limit: Int!, $cursor: Cursor) { streams(first: $limit, after: $cursor) { edges { cursor node { " +
            STREAM_FIELDS +
            " } } pageInfo { hasNextPage } } }",
          variables: { limit: 30, cursor: cursor ?? null },
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        });
        if (outcome.status === "failed") return outcome;
        for (const stream of outcome.items) {
          if (language && stream.language !== language) continue;
          if (seenStreamIds.has(stream.id)) continue;
          seenStreamIds.add(stream.id);
          items.push(stream);
        }
        const previousCursor = cursor;
        cursor = outcome.cursor;
        if (cursor === previousCursor) break;
        if (!cursor || items.length >= 10) break;
      }
      return {
        cache: { kind: "miss" },
        items,
        path: { kind: "guest", platform: "twitch" },
        platform: "twitch",
        status: "complete",
        ...(cursor === undefined ? {} : { cursor }),
      };
    },
    async getCategories(
      read: {
        readonly cursor?: string;
        readonly signal?: AbortSignal;
      } = {},
    ): Promise<PlatformReadOutcome<Category>> {
      return gqlCollection({
        fetchImpl: input.fetch,
        map: gamesFromPayload,
        nextCursor: (value) => connectionNextCursor(value, "games"),
        query:
          "query GetTopGames($limit: Int!, $cursor: Cursor) { games(first: $limit, after: $cursor) { edges { cursor node { id name slug boxArtURL displayName } } pageInfo { hasNextPage } } }",
        variables: { limit: 60, cursor: read.cursor ?? null },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategory(read: {
      readonly categoryId: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      return gqlCollection({
        fetchImpl: input.fetch,
        map: gameFromPayload,
        query:
          "query Game($id: ID!) { game(id: $id) { id name slug boxArtURL displayName } }",
        variables: { id: read.categoryId },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryStreams(read: {
      readonly categoryId: string;
      readonly cursor?: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream>> {
      return gqlCollection({
        fetchImpl: input.fetch,
        map: gameStreamsFromPayload,
        nextCursor: gameStreamsNextCursor,
        query:
          "query GameStreams($id: ID!, $limit: Int!, $cursor: Cursor) { game(id: $id) { id name streams(first: $limit, after: $cursor) { edges { cursor node { " +
          STREAM_FIELDS +
          " } } pageInfo { hasNextPage } } } }",
        variables: {
          id: read.categoryId,
          limit: 20,
          cursor: read.cursor ?? null,
        },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async searchPage<K extends MobileSearchKind>(
      read: SearchPageRequest<K>,
    ): Promise<SearchPageOutcome<K>> {
      const field = read.kind === "categories" ? "games" : "channels";
      const search = await gqlJson({
        fetchImpl: input.fetch,
        query:
          field === "games"
            ? 'query Search($query: String!, $cursor: String) { searchFor(userQuery: $query, platform: "web", options: { targets: [{ index: GAME, cursor: $cursor }] }) { games { cursor edges { item { ... on Game { id name displayName boxArtURL viewersCount } } } } } }'
            : 'query Search($query: String!, $cursor: String) { searchFor(userQuery: $query, platform: "web", options: { targets: [{ index: CHANNEL, cursor: $cursor }] }) { channels { cursor edges { item { ... on User { id login displayName profileImageURL(width: 70) roles { isPartner isAffiliate } stream { ' +
              STREAM_FIELDS +
              " } } } } } } }",
        variables: { query: read.query, cursor: read.cursor ?? null },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
      const exact =
        read.kind === "channels" && read.cursor === undefined
          ? await gqlJson({
              fetchImpl: input.fetch,
              query:
                "query User($login: String!) { user(login: $login) { id login displayName profileImageURL(width: 70) roles { isPartner isAffiliate } stream { id } } }",
              variables: { login: read.query },
              ...(read.signal === undefined ? {} : { signal: read.signal }),
            })
          : null;
      const path = { kind: "guest", platform: "twitch" } as const;
      const cache = { kind: "miss" } as const;
      if (search.kind === "failed") {
        const exactChannel =
          exact?.kind === "ready" ? usersFromPayload(exact.value) : [];
        return {
          cache,
          error: {
            code: search.code,
            retry: search.code === "cancelled" ? "none" : "manual",
          },
          items: exactChannel,
          path,
          platform: "twitch",
          resultKind: read.kind,
          status: exactChannel.length > 0 ? "partial" : "failed",
        } as unknown as SearchPageOutcome<K>;
      }
      const connection = asRecord(
        asRecord(dataRecord(search.value)?.searchFor)?.[field],
      );
      const rows = Array.isArray(connection?.edges) ? connection.edges : [];
      const nodes = rows.flatMap((edge) => {
        const item = asRecord(asRecord(edge)?.item);
        return item === null ? [] : [item];
      });
      const rawCursor = stringField(connection ?? {}, "cursor");
      const cursor =
        rawCursor && rawCursor !== read.cursor ? rawCursor : undefined;
      const common = {
        cache,
        path,
        platform: "twitch" as const,
        resultKind: read.kind,
        status:
          exact?.kind === "failed"
            ? ("partial" as const)
            : ("complete" as const),
        ...(exact?.kind === "failed"
          ? { error: { code: exact.code, retry: "manual" as const } }
          : {}),
        ...(cursor === undefined ? {} : { cursor }),
      };
      if (read.kind === "categories") {
        return {
          ...common,
          items: nodes.flatMap((node) => {
            const category = gameFromNode(node);
            return category === null ? [] : [category];
          }),
        } as unknown as SearchPageOutcome<K>;
      }
      const channels = rankProviderChannels(
        [
          ...(exact?.kind === "ready" ? usersFromPayload(exact.value) : []),
          ...nodes.flatMap((node) => {
            const channel = userFromRecord(node);
            return channel === null ? [] : [channel];
          }),
        ],
        read.query,
      );
      if (read.kind === "channels") {
        return {
          ...common,
          items: channels,
        } as unknown as SearchPageOutcome<K>;
      }
      const streams = nodes.flatMap((node) => {
        const channel = userFromRecord(node);
        const stream = streamFromNode(node.stream, channel ?? undefined);
        return stream === null ? [] : [stream];
      });
      return { ...common, items: streams } as unknown as SearchPageOutcome<K>;
    },
    async getChannel(read: {
      readonly login: string;
      readonly signal?: AbortSignal;
    }): Promise<ChannelPageOutcome> {
      const outcome = await gqlJson({
        fetchImpl: input.fetch,
        query:
          "query User($login: String!) { user(login: $login) { id login displayName description profileImageURL(width: 70) bannerImageURL roles { isPartner isAffiliate } followers { totalCount } stream { " +
          STREAM_FIELDS +
          " } } }",
        variables: { login: read.login },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
      if (outcome.kind === "failed") return failedPage(outcome.code);
      const channel = userFromRecord(dataRecord(outcome.value)?.user);
      if (channel === null) return failedPage("twitch-failed");
      const streamNode = dataRecord(dataRecord(outcome.value)?.user)?.stream;
      return {
        cache: { kind: "miss" },
        channel,
        live:
          streamNode === undefined ? null : streamFromNode(streamNode, channel),
        path: { kind: "guest", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      };
    },
  };
}

async function gqlCollection<T>(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly map: (value: unknown) => readonly T[];
  readonly nextCursor?: (value: unknown) => string | undefined;
  readonly query: string;
  readonly signal?: AbortSignal;
  readonly variables: Record<string, unknown>;
}): Promise<PlatformReadOutcome<T>> {
  const payload = await gqlJson(input);
  if (payload.kind === "failed") {
    return {
      cache: { kind: "miss" },
      error: {
        code: payload.code,
        retry: payload.code === "cancelled" ? "none" : "manual",
      },
      items: [],
      path:
        payload.code === "cancelled"
          ? { kind: "unavailable", platform: "twitch", reason: "cancelled" }
          : { kind: "guest", platform: "twitch" },
      platform: "twitch",
      status: "failed",
    };
  }
  const cursor = input.nextCursor?.(payload.value);
  return {
    cache: { kind: "miss" },
    items: input.map(payload.value),
    path: { kind: "guest", platform: "twitch" },
    platform: "twitch",
    status: "complete",
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function topStreamsNextCursor(value: unknown): string | undefined {
  return connectionNextCursor(value, "streams");
}

function gameStreamsNextCursor(value: unknown): string | undefined {
  const game = asRecord(dataRecord(value)?.game);
  if (game === null) return undefined;
  return connectionNextCursor({ data: game }, "streams");
}

function connectionNextCursor(
  value: unknown,
  field: "streams" | "games",
): string | undefined {
  const connection = asRecord(dataRecord(value)?.[field]);
  if (asRecord(connection?.pageInfo)?.hasNextPage !== true) return undefined;
  const edges = Array.isArray(connection?.edges) ? connection.edges : [];
  const last = asRecord(edges.at(-1));
  const cursor = last === null ? "" : stringField(last, "cursor");
  return cursor || undefined;
}

async function gqlJson(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly query: string;
  readonly signal?: AbortSignal;
  readonly variables: Record<string, unknown>;
}): Promise<
  | { readonly kind: "ready"; readonly value: unknown }
  | { readonly kind: "failed"; readonly code: string }
> {
  if (input.signal?.aborted) return { code: "cancelled", kind: "failed" };
  try {
    const response = await input.fetchImpl(GQL, {
      ...requestInit(
        { "Client-Id": CLIENT_ID, "Content-Type": "application/json" },
        input.signal,
      ),
      body: JSON.stringify({ query: input.query, variables: input.variables }),
      method: "POST",
    });
    if (!response.ok) {
      return {
        code: response.status === 401 ? "auth-lost" : "twitch-failed",
        kind: "failed",
      };
    }
    const value: unknown = await response.json();
    const errors = asRecord(value)?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return { code: "twitch-failed", kind: "failed" };
    }
    return { kind: "ready", value };
  } catch (error) {
    if (
      input.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return { code: "cancelled", kind: "failed" };
    }
    return { code: "twitch-failed", kind: "failed" };
  }
}

function streamsFromPayload(value: unknown): readonly Stream[] {
  return edges(dataRecord(value)?.streams).flatMap((node) => {
    const stream = streamFromNode(node);
    return stream === null ? [] : [stream];
  });
}

function gameStreamsFromPayload(value: unknown): readonly Stream[] {
  const game = dataRecord(dataRecord(value)?.game);
  if (game === null) return [];
  return edges(game.streams).flatMap((node) => {
    const stream = streamFromNode(node, undefined, game);
    return stream === null ? [] : [stream];
  });
}

function gamesFromPayload(value: unknown): readonly Category[] {
  return edges(dataRecord(value)?.games).flatMap((node) => {
    const category = gameFromNode(node);
    return category === null ? [] : [category];
  });
}

function gameFromPayload(value: unknown): readonly Category[] {
  const category = gameFromNode(dataRecord(value)?.game);
  return category === null ? [] : [category];
}

function usersFromPayload(value: unknown): readonly Channel[] {
  const channel = userFromRecord(dataRecord(value)?.user);
  return channel === null ? [] : [channel];
}

function streamFromNode(
  value: unknown,
  channel?: Channel,
  game?: Record<string, unknown>,
): Stream | null {
  const node = asRecord(value);
  if (node === null) return null;
  const broadcaster = asRecord(node.broadcaster);
  const login =
    channel?.username ||
    stringField(broadcaster ?? {}, "login") ||
    stringField(node, "login");
  const id = identifier(node, "id");
  if (id === "" || login === "") return null;
  const gameNode = asRecord(node.game) ?? game ?? null;
  return {
    channelAvatar:
      channel?.avatarUrl || stringField(broadcaster ?? {}, "profileImageURL"),
    channelDisplayName:
      channel?.displayName ||
      stringField(broadcaster ?? {}, "displayName") ||
      login,
    channelId: channel?.id || identifier(broadcaster ?? {}, "id") || login,
    channelName: login,
    id,
    isLive: true,
    language: stringField(
      asRecord(broadcaster?.broadcastSettings) ?? {},
      "language",
    ).toLowerCase(),
    platform: "twitch",
    startedAt: canonicalTimestamp(stringField(node, "createdAt")) ?? null,
    tags: gqlTags(node),
    thumbnailUrl: stringField(node, "previewImageURL"),
    title: stringField(node, "title"),
    viewerCount: numberField(node, "viewersCount"),
    ...(gqlBroadcasterPartner(broadcaster) || channel?.isPartner
      ? { channelIsVerified: true }
      : {}),
    ...(gameNode === null
      ? {}
      : {
          categoryId: identifier(gameNode, "id"),
          categoryName:
            stringField(gameNode, "displayName") ||
            stringField(gameNode, "name"),
        }),
  };
}

function gameFromNode(value: unknown): Category | null {
  const node = asRecord(value);
  if (node === null) return null;
  const id = identifier(node, "id");
  const name = stringField(node, "displayName") || stringField(node, "name");
  if (id === "" || name === "") return null;
  return {
    boxArtUrl: stringField(node, "boxArtURL")
      .replaceAll("{width}", "285")
      .replaceAll("{height}", "380"),
    id,
    name,
    platform: "twitch",
  };
}

function userFromRecord(value: unknown): Channel | null {
  const user = asRecord(value);
  if (user === null) return null;
  const username = stringField(user, "login");
  const id = identifier(user, "id") || username;
  if (id === "" || username === "") return null;
  const bio = stringField(user, "description");
  const bannerUrl = stringField(user, "bannerImageURL");
  const followerCount = asRecord(user.followers)?.totalCount;
  return {
    avatarUrl: stringField(user, "profileImageURL"),
    displayName: stringField(user, "displayName") || username,
    id,
    isLive: asRecord(user.stream) !== null,
    isPartner: gqlBroadcasterPartner(user),
    isVerified: gqlBroadcasterVerified(user),
    platform: "twitch",
    username,
    ...(bio === "" ? {} : { bio }),
    ...(bannerUrl === "" ? {} : { bannerUrl }),
    ...(typeof followerCount === "number" &&
    Number.isFinite(followerCount) &&
    followerCount >= 0
      ? { followerCount }
      : {}),
  };
}

function failedPage(code: string): ChannelPageOutcome {
  return {
    cache: { kind: "miss" },
    channel: null,
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    live: null,
    path:
      code === "cancelled"
        ? { kind: "unavailable", platform: "twitch", reason: "cancelled" }
        : { kind: "guest", platform: "twitch" },
    platform: "twitch",
    status: "failed",
  };
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  const root = asRecord(value);
  return root === null ? null : (asRecord(root.data) ?? root);
}

function edges(value: unknown): readonly Record<string, unknown>[] {
  const connection = asRecord(value);
  const list = Array.isArray(connection?.edges) ? connection.edges : [];
  return list.flatMap((edge) => {
    const node = asRecord(asRecord(edge)?.node);
    return node === null ? [] : [node];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function identifier(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? `${value}` : "";
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
