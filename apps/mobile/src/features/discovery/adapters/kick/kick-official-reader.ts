import type { Category, Channel, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  PlatformReadOutcome,
  SearchReadOutcome,
} from "../../capabilities/platform-reads";
import {
  emptySearchCatalog,
  streamsFromLiveChannels,
} from "../../domain/search-catalog";
import { requestInit } from "../../utils/optional";

const KICK_LIVESTREAMS = "https://api.kick.com/public/v1/livestreams?limit=20";

export function createKickOfficialReader(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
}) {
  return {
    platform: "kick" as const,
    async getCategories(read: {
      readonly signal?: AbortSignal;
    } = {}): Promise<PlatformReadOutcome<Category>> {
      return kickCollection({
        input,
        map: kickCategories,
        path: "https://api.kick.com/public/v1/categories?limit=20",
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
    async search(read: {
      readonly guest?: boolean;
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<SearchReadOutcome> {
      const [channels, categories] = await Promise.all([
        kickCollection({
          guest: read.guest === true,
          input,
          map: kickChannels,
          path: `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(read.query)}`,
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        }),
        kickCollection({
          guest: read.guest === true,
          input,
          map: kickCategories,
          path: `https://api.kick.com/public/v1/categories?q=${encodeURIComponent(read.query)}`,
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        }),
      ]);
      if (channels.status === "failed") return searchFromKick(channels);
      if (categories.status === "failed") return searchFromKick(categories);
      return {
        cache: { kind: "miss" },
        catalog: {
          categories: categories.items,
          channels: channels.items,
          clips: [],
          streams: streamsFromLiveChannels(channels.items),
          videos: [],
        },
        path: { kind: read.guest === true ? "guest" : "direct", platform: "kick" },
        platform: "kick",
        status: "complete",
      };
    },
    async getTopStreams(read: {
      readonly signal?: AbortSignal;
    } = {}): Promise<PlatformReadOutcome<Stream>> {
      if (read.signal?.aborted) return cancelled("kick");
      const accessToken = await input.readAccessToken();
      if (accessToken === null) {
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
        const response = await input.fetch(
          KICK_LIVESTREAMS,
          requestInit(
            { Authorization: `Bearer ${accessToken}` },
            read.signal,
          ),
        );
        if (!response.ok) {
          return failed(response.status === 401 ? "auth-lost" : "kick-failed");
        }
        const payload: unknown = await response.json();
        return {
          cache: { kind: "miss" },
          items: kickStreams(payload),
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

function kickChannels(value: unknown): readonly Channel[] {
  return kickRows(value).flatMap((record) => {
    const user =
      typeof record.user === "object" && record.user !== null
        ? (record.user as Record<string, unknown>)
        : record;
    const id = identifier(record, "id") || identifier(record, "slug");
    if (id === "") return [];
    return [
      {
        avatarUrl: stringField(user, "profile_pic") || stringField(user, "avatar"),
        displayName:
          stringField(user, "username") || stringField(record, "slug"),
        id,
        isLive: record.is_live === true,
        isPartner: record.is_partner === true,
        isVerified: record.verified === true,
        platform: "kick" as const,
        username: stringField(record, "slug") || stringField(user, "username"),
      },
    ];
  });
}

function kickStreams(value: unknown): readonly Stream[] {
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
    const channel =
      typeof record.channel === "object" && record.channel !== null
        ? (record.channel as Record<string, unknown>)
        : record;
    const user =
      typeof channel.user === "object" && channel.user !== null
        ? (channel.user as Record<string, unknown>)
        : channel;
    const id = identifier(record, "id");
    if (id === "") return [];
    return [
      {
        channelAvatar: stringField(user, "profile_pic"),
        channelDisplayName: stringField(user, "username"),
        channelId: identifier(channel, "id"),
        channelName: stringField(channel, "slug"),
        id,
        isLive: record.is_live !== false,
        language: stringField(record, "language"),
        platform: "kick" as const,
        startedAt: null,
        tags: [],
        thumbnailUrl: stringField(record, "thumbnail_url"),
        title: stringField(record, "session_title") || stringField(record, "title"),
        viewerCount:
          typeof record.viewer_count === "number" && record.viewer_count >= 0
            ? record.viewer_count
            : 0,
      },
    ];
  });
}

function kickRows(value: unknown): readonly Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );
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
    return {
      cache: { kind: "miss" },
      items: input.map(await response.json()),
      path: { kind: "direct", platform: "kick" },
      platform: "kick",
      status: "complete",
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
        boxArtUrl: stringField(record, "banner") || stringField(record, "thumbnail"),
        id,
        name: stringField(record, "name"),
        platform: "kick" as const,
      },
    ];
  });
}

function searchFromKick<T>(
  outcome: PlatformReadOutcome<T>,
): SearchReadOutcome {
  return {
    cache: outcome.cache,
    catalog: emptySearchCatalog(),
    path: outcome.path,
    platform: "kick",
    status: outcome.status,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  };
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
