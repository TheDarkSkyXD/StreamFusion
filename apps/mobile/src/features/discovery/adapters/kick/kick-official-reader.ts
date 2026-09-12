import type { Category, Channel, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
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
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream | Channel | Category>> {
      return kickCollection({
        input,
        map: kickStreams,
        path: `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(read.query)}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
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

async function kickCollection<T>(input: {
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
    const response = await input.input.fetch(
      input.path,
      requestInit(
        { Authorization: `Bearer ${accessToken}` },
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
