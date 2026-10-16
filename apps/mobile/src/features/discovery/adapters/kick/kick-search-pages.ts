import type { Channel, Stream } from "@streamfusion/core/content";
import { rankProviderChannels } from "../../domain/search-catalog";

import type {
  MobileSearchKind,
  SearchPageOutcome,
  SearchPageRequest,
} from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";
import {
  KICK_PUBLIC_ACCEPT,
  mapKickPublicCategories,
  mapKickPublicChannel,
  mapKickPublicLive,
} from "./kick-public-catalog";
import { readKickPublicStreamsPage } from "./kick-public-reads";
import type { createKickOfficialChannelReader } from "./kick-official-channel-reader";

type SearchPayload = {
  readonly channels: readonly unknown[];
  readonly categories: readonly unknown[];
};

export async function readKickSearchPage<K extends MobileSearchKind>(input: {
  readonly channelReader: ReturnType<typeof createKickOfficialChannelReader>;
  readonly fetch: typeof globalThis.fetch;
  readonly read: SearchPageRequest<K>;
}): Promise<SearchPageOutcome<K>> {
  const { read } = input;
  if (read.signal?.aborted) return failed(read.kind, "cancelled");
  if (
    read.cursor === "directory" ||
    read.cursor?.startsWith("directory:") === true
  ) {
    return readDirectoryPage(input);
  }
  if (read.cursor?.startsWith("categories:") === true) {
    return readCategoryPage(input);
  }
  if (read.cursor !== undefined) return failed(read.kind, "kick-failed");
  const broad = await requestJson(
    input.fetch,
    `https://kick.com/api/search?searched_word=${encodeURIComponent(read.query)}`,
    read.signal,
  );
  const exact =
    read.kind === "channels" && read.query.trim() !== ""
      ? await input.channelReader.getChannel({
          channel: {
            id: read.query.trim(),
            platform: "kick",
            username: read.query.trim(),
          },
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        })
      : null;
  if (broad.kind === "failed") {
    const channel = exact?.channel;
    if (channel === null || channel === undefined) {
      return failed(read.kind, broad.code);
    }
    return {
      ...base(read.kind),
      error: { code: broad.code, retry: "manual" },
      items: [channel],
      status: "partial",
    } as unknown as SearchPageOutcome<K>;
  }
  const payload = parseSearchPayload(broad.value);
  if (payload === null) return failed(read.kind, "kick-failed");
  const channels = rankProviderChannels(
    [
      ...(exact?.channel ? [exact.channel] : []),
      ...payload.channels.flatMap((value) => {
        const channel = mapKickPublicChannel(value);
        return channel === null ? [] : [channel];
      }),
    ],
    read.query,
  );
  if (read.kind === "channels") {
    return {
      ...base(read.kind),
      items: channels,
      ...(payload.channels.length >= 20 ? { cursor: "directory" } : {}),
    } as unknown as SearchPageOutcome<K>;
  }
  if (read.kind === "streams") {
    const streams = payload.channels.flatMap((value) => {
      const channel = mapKickPublicChannel(value);
      if (channel === null || !channel.isLive || !hasLivestream(value))
        return [];
      const stream = mapKickPublicLive(value, channel);
      return stream === null ? [] : [stream];
    });
    const directory = await readKickPublicStreamsPage({
      fetchImpl: input.fetch,
      ...(read.signal === undefined ? {} : { signal: read.signal }),
    });
    if (directory.status === "failed") {
      return {
        ...base(read.kind),
        error: directory.error,
        items: streams,
        status: streams.length > 0 ? "partial" : "failed",
      } as unknown as SearchPageOutcome<K>;
    }
    const matching = directory.items.filter(
      (stream) =>
        stream.channelName
          .toLowerCase()
          .includes(read.query.trim().toLowerCase()) ||
        stream.channelDisplayName
          .toLowerCase()
          .includes(read.query.trim().toLowerCase()) ||
        stream.title.toLowerCase().includes(read.query.trim().toLowerCase()),
    );
    return {
      ...base(read.kind),
      items: [...streams, ...matching],
      ...(directory.cursor === undefined
        ? {}
        : { cursor: `directory:${directory.cursor}` }),
    } as unknown as SearchPageOutcome<K>;
  }
  const categories = mapKickPublicCategories(payload.categories).filter(
    (item) => item.name.toLowerCase().includes(read.query.trim().toLowerCase()),
  );
  return {
    ...base(read.kind),
    items: categories,
    ...(payload.categories.length >= 20 ? { cursor: "categories:1" } : {}),
  } as unknown as SearchPageOutcome<K>;
}

async function readDirectoryPage<K extends MobileSearchKind>(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly read: SearchPageRequest<K>;
}): Promise<SearchPageOutcome<K>> {
  const { read } = input;
  if (read.kind === "categories") return failed(read.kind, "kick-failed");
  const after =
    read.cursor === "directory"
      ? undefined
      : read.cursor?.slice("directory:".length);
  const response = await readKickPublicStreamsPage({
    fetchImpl: input.fetch,
    ...(after === undefined ? {} : { cursor: after }),
    ...(read.signal === undefined ? {} : { signal: read.signal }),
  });
  if (response.status === "failed")
    return failed(read.kind, response.error?.code ?? "kick-failed");
  const streams = response.items;
  const query = read.query.trim().toLowerCase();
  const matches = streams.filter(
    (stream) =>
      stream.channelName.toLowerCase().includes(query) ||
      stream.channelDisplayName.toLowerCase().includes(query),
  );
  const items: readonly Channel[] | readonly Stream[] =
    read.kind === "streams"
      ? matches
      : matches.flatMap((stream) => {
          const channel = mapKickPublicChannel({
            id: stream.channelId,
            slug: stream.channelName,
            isLive: true,
            user: {
              username: stream.channelDisplayName,
              profilePic: stream.channelAvatar,
            },
          });
          return channel === null ? [] : [channel];
        });
  return {
    ...base(read.kind),
    items,
    ...(response.cursor === undefined
      ? {}
      : { cursor: `directory:${response.cursor}` }),
  } as unknown as SearchPageOutcome<K>;
}

async function readCategoryPage<K extends MobileSearchKind>(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly read: SearchPageRequest<K>;
}): Promise<SearchPageOutcome<K>> {
  const { read } = input;
  if (read.kind !== "categories") return failed(read.kind, "kick-failed");
  const pageNumber = Number(read.cursor?.slice("categories:".length));
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    return failed(read.kind, "kick-failed");
  }
  const url = new URL("https://kick.com/api/v1/subcategories");
  url.searchParams.set("limit", "60");
  url.searchParams.set("page", String(pageNumber));
  const response = await requestJson(input.fetch, url.toString(), read.signal);
  if (response.kind === "failed") return failed(read.kind, response.code);
  const categories = mapKickPublicCategories(response.value).filter((item) =>
    item.name.toLowerCase().includes(read.query.trim().toLowerCase()),
  );
  return {
    ...base(read.kind),
    items: categories,
    ...(hasNextPage(response.value, pageNumber)
      ? { cursor: `categories:${pageNumber + 1}` }
      : {}),
  } as unknown as SearchPageOutcome<K>;
}

function hasNextPage(value: unknown, page: number): boolean {
  const record = asRecord(value);
  const last = record?.last_page;
  return typeof last === "number" && page < last;
}

function hasLivestream(value: unknown): boolean {
  const record = asRecord(value);
  return (
    asRecord(record?.livestream) !== null || asRecord(record?.stream) !== null
  );
}

function parseSearchPayload(value: unknown): SearchPayload | null {
  const record = asRecord(value);
  if (
    record === null ||
    !Array.isArray(record.channels) ||
    !Array.isArray(record.categories)
  ) {
    return null;
  }
  return { channels: record.channels, categories: record.categories };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function requestJson(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  signal?: AbortSignal,
): Promise<
  | { readonly kind: "ready"; readonly value: unknown }
  | { readonly kind: "failed"; readonly code: string }
> {
  if (signal?.aborted) return { kind: "failed", code: "cancelled" };
  try {
    const response = await fetchImpl(
      url,
      requestInit(KICK_PUBLIC_ACCEPT, signal),
    );
    if (!response.ok) return { kind: "failed", code: "kick-failed" };
    const value: unknown = await response.json();
    return { kind: "ready", value };
  } catch (error) {
    return {
      kind: "failed",
      code:
        signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
          ? "cancelled"
          : "kick-failed",
    };
  }
}

function base<K extends MobileSearchKind>(kind: K) {
  return {
    cache: { kind: "miss" } as const,
    path: { kind: "guest", platform: "kick" } as const,
    platform: "kick" as const,
    resultKind: kind,
    status: "complete" as const,
  };
}

function failed<K extends MobileSearchKind>(
  kind: K,
  code: string,
): SearchPageOutcome<K> {
  return {
    ...base(kind),
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    status: "failed",
  } as unknown as SearchPageOutcome<K>;
}
