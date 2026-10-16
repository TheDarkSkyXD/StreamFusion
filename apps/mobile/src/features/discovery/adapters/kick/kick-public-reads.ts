import type { Category, Stream } from "@streamfusion/core/content";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import type { LiveStreamCatalog } from "../../capabilities/live-stream-catalog";
import { requestInit } from "../../utils/optional";
import {
  KICK_FEATURED_LIVESTREAMS,
  KICK_PUBLIC_ACCEPT,
  KICK_PUBLIC_SUBCATEGORIES,
  mapKickPublicCategories,
  mapKickPublicStreams,
} from "./kick-public-catalog";

export async function readKickPublicTopStreams(
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
  liveCatalog?: LiveStreamCatalog,
  language?: string,
): Promise<PlatformReadOutcome<Stream>> {
  if (liveCatalog) {
    const catalog = await liveCatalog.read(
      signal === undefined ? {} : { signal },
    );
    if (
      signal?.aborted ||
      (catalog.kind === "unavailable" && catalog.failure.kind === "cancelled")
    ) {
      return {
        cache: { kind: "miss" },
        error: { code: "cancelled", retry: "none" },
        items: [],
        path: { kind: "unavailable", platform: "kick", reason: "cancelled" },
        platform: "kick",
        status: "failed",
      };
    }
    if (catalog.kind === "ready") {
      return {
        cache: { kind: "miss" },
        items: catalog.entries
          .map((entry) => entry.stream)
          .filter((stream) => !language || stream.language === language),
        path: { kind: "guest", platform: "kick" },
        platform: "kick",
        status: "complete",
      };
    }
  }
  const outcome = await kickPublicCollection({
    fetchImpl,
    map: mapKickPublicStreams,
    url: KICK_FEATURED_LIVESTREAMS,
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    ...outcome,
    items: outcome.items.filter(
      (stream) => !language || stream.language === language,
    ),
  };
}

export async function readKickPublicCategories(
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
  cursor?: string,
): Promise<PlatformReadOutcome<Category>> {
  const url = new URL(KICK_PUBLIC_SUBCATEGORIES);
  url.searchParams.set("limit", "60");
  if (cursor !== undefined) url.searchParams.set("page", cursor);
  return kickPublicCollection({
    fetchImpl,
    map: mapKickPublicCategories,
    nextCursor: kickCategoryCursor,
    url: url.toString(),
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function readKickPublicStreamsPage(input: {
  readonly categoryId?: string;
  readonly cursor?: string;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<Stream>> {
  const url = new URL("https://web.kick.com/api/v1/livestreams");
  url.searchParams.set("limit", "24");
  url.searchParams.set("sort", "viewer_count_desc");
  if (input.categoryId) url.searchParams.set("category_id", input.categoryId);
  if (input.cursor) url.searchParams.set("after", input.cursor);
  const outcome = await kickPublicCollection({
    fetchImpl: input.fetchImpl,
    headers: {
      Accept: "application/json",
      Referer: "https://kick.com/",
      Origin: "https://kick.com",
      "x-app-platform": "web",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    },
    map: mapKickWebCategoryStreams,
    nextCursor: kickWebCategoryCursor,
    valid: isKickWebStreamsPage,
    url: url.toString(),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const items =
    input.categoryId === undefined
      ? outcome.items
      : outcome.items.filter(
          (stream) => stream.categoryId === input.categoryId,
        );
  if (outcome.cursor === input.cursor) {
    const { cursor: _cursor, ...page } = outcome;
    return { ...page, items };
  }
  return { ...outcome, items };
}

async function kickPublicCollection<T>(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
  readonly map: (value: unknown) => readonly T[];
  readonly nextCursor?: (value: unknown) => string | undefined;
  readonly valid?: (value: unknown) => boolean;
  readonly signal?: AbortSignal;
  readonly url: string;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) {
    return {
      cache: { kind: "miss" },
      error: { code: "cancelled", retry: "none" },
      items: [],
      path: { kind: "unavailable", platform: "kick", reason: "cancelled" },
      platform: "kick",
      status: "failed",
    };
  }
  try {
    const response = await input.fetchImpl(
      input.url,
      requestInit(input.headers ?? KICK_PUBLIC_ACCEPT, input.signal),
    );
    if (!response.ok) {
      return {
        cache: { kind: "miss" },
        error: { code: "kick-failed", retry: "manual" },
        items: [],
        path: { kind: "guest", platform: "kick" },
        platform: "kick",
        status: "failed",
      };
    }
    const payload: unknown = await response.json();
    if (input.valid && !input.valid(payload)) {
      return {
        cache: { kind: "miss" },
        error: { code: "kick-failed", retry: "manual" },
        items: [],
        path: { kind: "guest", platform: "kick" },
        platform: "kick",
        status: "failed",
      };
    }
    if (input.signal?.aborted) {
      return {
        cache: { kind: "miss" },
        error: { code: "cancelled", retry: "none" },
        items: [],
        path: { kind: "unavailable", platform: "kick", reason: "cancelled" },
        platform: "kick",
        status: "failed",
      };
    }
    const cursor = input.nextCursor?.(payload);
    return {
      cache: { kind: "miss" },
      items: input.map(payload),
      path: { kind: "guest", platform: "kick" },
      platform: "kick",
      status: "complete",
      ...(cursor === undefined ? {} : { cursor }),
    };
  } catch (error) {
    if (
      input.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return {
        cache: { kind: "miss" },
        error: { code: "cancelled", retry: "none" },
        items: [],
        path: { kind: "unavailable", platform: "kick", reason: "cancelled" },
        platform: "kick",
        status: "failed",
      };
    }
    return {
      cache: { kind: "miss" },
      error: { code: "kick-failed", retry: "manual" },
      items: [],
      path: { kind: "guest", platform: "kick" },
      platform: "kick",
      status: "failed",
    };
  }
}

function kickCategoryCursor(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("current_page" in value) || !("last_page" in value)) return undefined;
  const current = value.current_page;
  const last = value.last_page;
  return typeof current === "number" &&
    typeof last === "number" &&
    current < last
    ? String(current + 1)
    : undefined;
}

function webCategoryData(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || !("data" in value))
    return null;
  const data = value.data;
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function isKickWebStreamsPage(value: unknown): boolean {
  return Array.isArray(webCategoryData(value)?.livestreams);
}

function mapKickWebCategoryStreams(value: unknown): readonly Stream[] {
  const data = webCategoryData(value);
  return mapKickPublicStreams(data?.livestreams);
}

function kickWebCategoryCursor(value: unknown): string | undefined {
  const pagination = webCategoryData(value)?.pagination;
  if (
    typeof pagination !== "object" ||
    pagination === null ||
    !("next_cursor" in pagination)
  )
    return undefined;
  return typeof pagination.next_cursor === "string" &&
    pagination.next_cursor !== ""
    ? pagination.next_cursor
    : undefined;
}
