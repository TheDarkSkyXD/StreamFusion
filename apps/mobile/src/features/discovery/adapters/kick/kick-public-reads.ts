import type { Category, Stream } from "@streamfusion/core/content";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";
import {
  KICK_FEATURED_LIVESTREAMS,
  KICK_PUBLIC_ACCEPT,
  KICK_PUBLIC_LIVESTREAMS,
  KICK_PUBLIC_SUBCATEGORIES,
  mapKickPublicCategories,
  mapKickPublicStreams,
} from "./kick-public-catalog";

export async function readKickPublicTopStreams(
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<PlatformReadOutcome<Stream>> {
  return kickPublicCollection({
    fetchImpl,
    map: mapKickPublicStreams,
    url: KICK_FEATURED_LIVESTREAMS,
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function readKickPublicCategories(
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<PlatformReadOutcome<Category>> {
  return kickPublicCollection({
    fetchImpl,
    map: mapKickPublicCategories,
    url: KICK_PUBLIC_SUBCATEGORIES,
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function readKickPublicCategoryStreams(input: {
  readonly categoryId: string;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<Stream>> {
  const pages = await Promise.all([
    kickPublicCollection({
      fetchImpl: input.fetchImpl,
      map: mapKickPublicStreams,
      url: KICK_FEATURED_LIVESTREAMS,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    kickPublicCollection({
      fetchImpl: input.fetchImpl,
      map: mapKickPublicStreams,
      url: KICK_PUBLIC_LIVESTREAMS,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);
  const failed = pages.find((page) => page.status === "failed");
  if (failed && pages.every((page) => page.status === "failed")) return failed;
  const items = uniqueStreams(
    pages.flatMap((page) =>
      page.items.filter((stream) => stream.categoryId === input.categoryId),
    ),
  );
  return {
    cache: { kind: "miss" },
    items,
    path: { kind: "guest", platform: "kick" },
    platform: "kick",
    status: "complete",
  };
}

async function kickPublicCollection<T>(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly map: (value: unknown) => readonly T[];
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
      requestInit(KICK_PUBLIC_ACCEPT, input.signal),
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
    return {
      cache: { kind: "miss" },
      items: input.map(await response.json()),
      path: { kind: "guest", platform: "kick" },
      platform: "kick",
      status: "complete",
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

function uniqueStreams(items: readonly Stream[]): readonly Stream[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
