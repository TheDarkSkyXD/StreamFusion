import type { Category, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";
import { mapKickOfficialStreams } from "./kick-official-streams";
import {
  readKickPublicCategories,
  readKickPublicStreamsPage,
} from "./kick-public-reads";

type KickInput = {
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
};

export function createKickOfficialCategoryReads(input: KickInput) {
  return {
    async getCategory(read: {
      readonly categoryId: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      if ((await input.readAccessToken()) === null) {
        const categories = await readKickPublicCategories(
          input.fetch,
          read.signal,
        );
        if (categories.status === "failed") return categories;
        return {
          ...categories,
          items: categories.items.filter((item) => item.id === read.categoryId),
        };
      }
      return kickCollection({
        input,
        map: kickCategories,
        path: `https://api.kick.com/public/v2/categories?id=${encodeURIComponent(read.categoryId)}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryStreams(read: {
      readonly categoryId: string;
      readonly cursor?: string;
      readonly language?: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream>> {
      if (read.signal?.aborted) return failed("cancelled");
      if ((await input.readAccessToken()) === null) {
        const outcome = await readKickPublicStreamsPage({
          categoryId: read.categoryId,
          ...(read.cursor === undefined ? {} : { cursor: read.cursor }),
          fetchImpl: input.fetch,
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        });
        return read.language === undefined
          ? outcome
          : {
              ...outcome,
              items: outcome.items.filter(
                (stream) => stream.language === read.language,
              ),
            };
      }
      const params = new URLSearchParams({
        category_id: read.categoryId,
        limit: "20",
      });
      if (read.language) params.set("language_code", read.language);
      if (read.cursor) params.set("after", read.cursor);
      return kickCollection({
        input,
        map: mapKickOfficialStreams,
        nextCursor: officialStreamCursor,
        path: `https://api.kick.com/public/v2/livestreams?${params}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async searchCategories(read: {
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      if ((await input.readAccessToken()) === null) {
        const categories = await readKickPublicCategories(
          input.fetch,
          read.signal,
        );
        if (categories.status === "failed") return categories;
        const needle = read.query.trim().toLowerCase();
        return {
          ...categories,
          items: categories.items.filter((item) =>
            item.name.toLowerCase().includes(needle),
          ),
        };
      }
      return kickCollection({
        input,
        map: kickCategories,
        path: `https://api.kick.com/public/v1/categories?q=${encodeURIComponent(read.query)}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    unsupportedClips(): {
      readonly kind: "unsupported";
      readonly platform: Platform;
      readonly reason: "kick-clips-unsupported";
    } {
      return {
        kind: "unsupported",
        platform: "kick",
        reason: "kick-clips-unsupported",
      };
    },
    unsupportedVideos(): {
      readonly kind: "unsupported";
      readonly platform: Platform;
      readonly reason: "kick-videos-unsupported";
    } {
      return {
        kind: "unsupported",
        platform: "kick",
        reason: "kick-videos-unsupported",
      };
    },
  };
}

async function kickCollection<T>(input: {
  readonly input: KickInput;
  readonly map: (value: unknown) => readonly T[];
  readonly nextCursor?: (value: unknown) => string | undefined;
  readonly path: string;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return failed("cancelled");
  const accessToken = await input.input.readAccessToken();
  if (input.signal?.aborted) return failed("cancelled");
  if (accessToken === null) return failed("signed-out-login-required");
  try {
    const response = await input.input.fetch(
      input.path,
      requestInit({ Authorization: `Bearer ${accessToken}` }, input.signal),
    );
    if (!response.ok) {
      return failed(response.status === 401 ? "auth-lost" : "kick-failed");
    }
    const payload: unknown = await response.json();
    if (input.signal?.aborted) return failed("cancelled");
    const cursor = input.nextCursor?.(payload);
    return {
      cache: { kind: "miss" },
      items: input.map(payload),
      path: { kind: "direct", platform: "kick" },
      platform: "kick",
      status: "complete",
      ...(cursor === undefined ? {} : { cursor }),
    };
  } catch (error) {
    if (input.signal?.aborted || isAbort(error)) return failed("cancelled");
    return failed("kick-failed");
  }
}

function officialStreamCursor(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("pagination" in value))
    return undefined;
  const pagination = value.pagination;
  if (
    typeof pagination !== "object" ||
    pagination === null ||
    !("cursor" in pagination)
  )
    return undefined;
  return typeof pagination.cursor === "string" && pagination.cursor !== ""
    ? pagination.cursor
    : undefined;
}

function kickCategories(value: unknown): readonly Category[] {
  return rows(value).flatMap((record) => {
    const id = identifier(record, "id");
    return id === ""
      ? []
      : [
          {
            boxArtUrl:
              stringField(record, "thumbnail_url") ||
              stringField(record, "banner") ||
              stringField(record, "thumbnail"),
            id,
            name: stringField(record, "name"),
            platform: "kick" as const,
          },
        ];
  });
}

function rows(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return list.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );
}

function failed<T>(code: string): PlatformReadOutcome<T> {
  const cancelled = code === "cancelled";
  const auth = code === "auth-lost" || code === "signed-out-login-required";
  return {
    cache: { kind: "miss" },
    error: { code, retry: cancelled ? "none" : "manual" },
    items: [],
    path: auth
      ? {
          kind: "unavailable",
          platform: "kick",
          reason:
            code === "auth-lost" ? "auth-lost" : "signed-out-login-required",
        }
      : cancelled
        ? { kind: "unavailable", platform: "kick", reason: "cancelled" }
        : { kind: "direct", platform: "kick" },
    platform: "kick",
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
