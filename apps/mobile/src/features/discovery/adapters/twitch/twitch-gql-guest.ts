import type { Category, Channel, Stream } from "@streamfusion/core/content";

import type {
  ChannelPageOutcome,
  PlatformReadOutcome,
  SearchReadOutcome,
} from "../../capabilities/platform-reads";
import { emptySearchCatalog, streamsFromLiveChannels } from "../../domain/search-catalog";
import {
  gqlBroadcasterPartner,
  gqlBroadcasterVerified,
  gqlTags,
} from "../../utils/catalog-fields";
import { requestInit } from "../../utils/optional";

const GQL = "https://gql.twitch.tv/gql";
const CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const STREAM_FIELDS = `id title viewersCount previewImageURL(width: 440, height: 248) freeformTags { name } broadcaster { id login displayName profileImageURL(width: 70) roles { isPartner isAffiliate } } game { id name slug }`;

export function createTwitchGqlGuestReader(input: {
  readonly fetch: typeof globalThis.fetch;
}) {
  return {
    async getTopStreams(read: {
      readonly signal?: AbortSignal;
    } = {}): Promise<PlatformReadOutcome<Stream>> {
      return gqlCollection({
        fetchImpl: input.fetch,
        map: streamsFromPayload,
        query:
          "query GetTopStreams($limit: Int!) { streams(first: $limit) { edges { node { " +
          STREAM_FIELDS +
          " } } } }",
        variables: { limit: 20 },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategories(read: {
      readonly signal?: AbortSignal;
    } = {}): Promise<PlatformReadOutcome<Category>> {
      return gqlCollection({
        fetchImpl: input.fetch,
        map: gamesFromPayload,
        query:
          "query GetTopGames($limit: Int!) { games(first: $limit) { edges { node { id name slug boxArtURL displayName } } } }",
        variables: { limit: 20 },
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
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream>> {
      return gqlCollection({
        fetchImpl: input.fetch,
        map: gameStreamsFromPayload,
        query:
          "query GameStreams($id: ID!, $limit: Int!) { game(id: $id) { id name streams(first: $limit) { edges { node { " +
          STREAM_FIELDS +
          " } } } } }",
        variables: { id: read.categoryId, limit: 20 },
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async search(read: {
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<SearchReadOutcome> {
      const [channels, categories] = await Promise.all([
        gqlCollection({
          fetchImpl: input.fetch,
          map: usersFromPayload,
          query:
            "query User($login: String!) { user(login: $login) { id login displayName profileImageURL(width: 70) stream { id } } }",
          variables: { login: read.query },
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        }),
        gqlCollection({
          fetchImpl: input.fetch,
          map: gamesFromPayload,
          query:
            "query GetTopGames($limit: Int!) { games(first: $limit) { edges { node { id name slug boxArtURL displayName } } } }",
          variables: { limit: 20 },
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        }),
      ]);
      if (channels.status === "failed") return searchFrom(channels);
      if (categories.status === "failed") return searchFrom(categories);
      const matchedCategories = categories.items.filter((item) =>
        item.name.toLowerCase().includes(read.query.trim().toLowerCase()),
      );
      return {
        cache: { kind: "miss" },
        catalog: {
          categories: matchedCategories,
          channels: channels.items,
          clips: [],
          streams: streamsFromLiveChannels(channels.items),
          videos: [],
        },
        path: { kind: "guest", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      };
    },
    async getChannel(read: {
      readonly login: string;
      readonly signal?: AbortSignal;
    }): Promise<ChannelPageOutcome> {
      const outcome = await gqlJson({
        fetchImpl: input.fetch,
        query:
          "query User($login: String!) { user(login: $login) { id login displayName description profileImageURL(width: 70) stream { " +
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
          streamNode === undefined
            ? null
            : streamFromNode(streamNode, channel),
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
  return {
    cache: { kind: "miss" },
    items: input.map(payload.value),
    path: { kind: "guest", platform: "twitch" },
    platform: "twitch",
    status: "complete",
  };
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
    const response = await input.fetchImpl(
      GQL,
      {
        ...requestInit(
          { "Client-Id": CLIENT_ID, "Content-Type": "application/json" },
          input.signal,
        ),
        body: JSON.stringify({ query: input.query, variables: input.variables }),
        method: "POST",
      },
    );
    if (!response.ok) {
      return {
        code: response.status === 401 ? "auth-lost" : "twitch-failed",
        kind: "failed",
      };
    }
    return { kind: "ready", value: await response.json() };
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
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
      channel?.avatarUrl ||
      stringField(broadcaster ?? {}, "profileImageURL"),
    channelDisplayName:
      channel?.displayName ||
      stringField(broadcaster ?? {}, "displayName") ||
      login,
    channelId:
      channel?.id ||
      identifier(broadcaster ?? {}, "id") ||
      login,
    channelName: login,
    id,
    isLive: true,
    language: "",
    platform: "twitch",
    startedAt: null,
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
            stringField(gameNode, "displayName") || stringField(gameNode, "name"),
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
  };
}

function searchFrom<T>(outcome: PlatformReadOutcome<T>): SearchReadOutcome {
  return {
    cache: outcome.cache,
    catalog: emptySearchCatalog(),
    path: outcome.path,
    platform: "twitch",
    status: outcome.status,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
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
  return root === null ? null : asRecord(root.data) ?? root;
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
