import type { Category, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";
import type { LiveStreamCatalog } from "../../capabilities/live-stream-catalog";

import type {
  PlatformReadOutcome,
  MobileSearchKind,
  SearchPageOutcome,
  SearchPageRequest,
} from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";
import { createKickLiveCatalog } from "./kick-live-catalog";
import { mapKickOfficialStreams } from "./kick-official-streams";
import { createKickOfficialCategoryReads } from "./kick-official-category-reader";
import { createKickOfficialChannelReader } from "./kick-official-channel-reader";
import { readKickSearchPage } from "./kick-search-pages";
import {
  readKickPublicCategories,
  readKickPublicTopStreams,
} from "./kick-public-reads";

export function createKickOfficialReader(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
  readonly liveCatalog?: LiveStreamCatalog;
}) {
  const liveCatalog =
    input.liveCatalog ?? createKickLiveCatalog({ fetch: input.fetch });
  const channelReader = createKickOfficialChannelReader({
    ...input,
    liveCatalog,
  });
  return {
    ...createKickOfficialCategoryReads(input),
    ...channelReader,
    platform: "kick" as const,
    searchPage<K extends MobileSearchKind>(
      read: SearchPageRequest<K>,
    ): Promise<SearchPageOutcome<K>> {
      return readKickSearchPage({ channelReader, fetch: input.fetch, read });
    },
    async getCategories(
      read: {
        readonly cursor?: string;
        readonly signal?: AbortSignal;
      } = {},
    ): Promise<PlatformReadOutcome<Category>> {
      if ((await input.readAccessToken()) === null) {
        return readKickPublicCategories(input.fetch, read.signal, read.cursor);
      }
      const params = new URLSearchParams({ limit: "60" });
      if (read.cursor !== undefined) params.set("after", read.cursor);
      return kickCollection({
        input,
        map: kickCategories,
        path: `https://api.kick.com/public/v2/categories?${params}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getFollowedStreams(): Promise<PlatformReadOutcome<Stream>> {
      const accessToken = await input.readAccessToken();
      return {
        cache: { kind: "miss" },
        error: {
          code:
            accessToken === null
              ? "signed-out-login-required"
              : "followed-unavailable",
          retry: "manual",
        },
        items: [],
        path: {
          kind: "unavailable",
          platform: "kick",
          reason:
            accessToken === null ? "signed-out-login-required" : "auth-lost",
        },
        platform: "kick",
        status: "failed",
      };
    },
    async getTopStreams(
      read: {
        readonly language?: string;
        readonly signal?: AbortSignal;
      } = {},
    ): Promise<PlatformReadOutcome<Stream>> {
      if (read.signal?.aborted) return cancelled("kick");
      const accessToken = await input.readAccessToken();
      if (read.signal?.aborted) return cancelled("kick");
      if (accessToken === null) {
        return readKickPublicTopStreams(
          input.fetch,
          read.signal,
          liveCatalog,
          read.language,
        );
      }
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (read.language) params.set("language_code", read.language);
        const response = await input.fetch(
          `https://api.kick.com/public/v2/livestreams?${params}`,
          requestInit({ Authorization: `Bearer ${accessToken}` }, read.signal),
        );
        if (!response.ok) {
          return failed(response.status === 401 ? "auth-lost" : "kick-failed");
        }
        const payload: unknown = await response.json();
        if (read.signal?.aborted) return cancelled("kick");
        return {
          cache: { kind: "miss" },
          items: mapKickOfficialStreams(payload).filter(
            (stream) => !read.language || stream.language === read.language,
          ),
          path: { kind: "direct", platform: "kick" },
          platform: "kick",
          status: "complete",
        };
      } catch (error) {
        if (read.signal?.aborted || isAbort(error)) return cancelled("kick");
        return failed("kick-failed");
      }
    },
  };
}

async function kickCollection<T>(input: {
  readonly guest?: boolean;
  readonly input: {
    readonly fetch: typeof globalThis.fetch;
    readonly readAccessToken: () => Promise<string | null>;
  };
  readonly map: (value: unknown) => readonly T[];
  readonly path: string;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return cancelled("kick");
  const accessToken = await input.input.readAccessToken();
  if (accessToken === null && input.guest !== true) {
    return {
      cache: { kind: "miss" },
      error: { code: "signed-out-login-required", retry: "manual" },
      items: [],
      path: {
        kind: "unavailable",
        platform: "kick",
        reason: "signed-out-login-required",
      },
      platform: "kick",
      status: "failed",
    };
  }
  try {
    const response = await input.input.fetch(
      input.path,
      requestInit(
        accessToken === null ? {} : { Authorization: `Bearer ${accessToken}` },
        input.signal,
      ),
    );
    if (!response.ok) {
      return failed(response.status === 401 ? "auth-lost" : "kick-failed");
    }
    const payload: unknown = await response.json();
    const pagination =
      typeof payload === "object" && payload !== null && "pagination" in payload
        ? payload.pagination
        : undefined;
    const cursor =
      typeof pagination === "object" &&
      pagination !== null &&
      "next_cursor" in pagination &&
      typeof pagination.next_cursor === "string" &&
      pagination.next_cursor !== ""
        ? pagination.next_cursor
        : undefined;
    return {
      cache: { kind: "miss" },
      items: input.map(payload),
      path: {
        kind: input.guest === true ? "guest" : "direct",
        platform: "kick",
      },
      platform: "kick",
      status: "complete",
      ...(cursor === undefined ? {} : { cursor }),
    };
  } catch (error) {
    if (input.signal?.aborted || isAbort(error)) return cancelled("kick");
    return failed("kick-failed");
  }
}

function kickCategories(value: unknown): readonly Category[] {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    const id = identifier(record, "id");
    if (id === "") return [];
    return [
      {
        boxArtUrl:
          stringField(record, "banner") || stringField(record, "thumbnail"),
        id,
        name: stringField(record, "name"),
        platform: "kick" as const,
      },
    ];
  });
}

function failed<T>(code: string): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: "manual" },
    items: [],
    path:
      code === "auth-lost"
        ? { kind: "unavailable", platform: "kick", reason: "auth-lost" }
        : { kind: "direct", platform: "kick" },
    platform: "kick",
    status: "failed",
  };
}

function cancelled<T>(platform: Platform): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code: "cancelled", retry: "none" },
    items: [],
    path: { kind: "unavailable", platform, reason: "cancelled" },
    platform,
    status: "failed",
  };
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

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
