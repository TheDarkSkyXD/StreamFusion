import type { Platform } from "@streamfusion/core/platform";
import type {
  FollowedClipPeriod,
  FollowedIdentityRef,
  FollowedRecordedSort,
} from "@streamfusion/core/relay";

import type {
  FollowedContentReader,
  FollowedReadOutcome,
  FollowedRecordedOutcome,
} from "../../capabilities/following-session";
import { requestInit } from "../../utils/following-query";
import {
  failedRead,
  failedRecorded,
  parseChannels,
  parseClips,
  parseStreams,
  parseVideos,
} from "./followed-content-parse";

export function createRelayFollowedContentReader(input: {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly installation: () => Promise<
    | { readonly kind: "none" }
    | { readonly kind: "ready"; readonly credential: string }
  >;
  readonly network: () => Promise<"online" | "offline">;
}) {
  return {
    readStreams: (read) =>
      identityRead({
        input,
        parse: parseStreams,
        path: "v1/followed-content/streams",
        read,
      }),
    readChannels: (read) =>
      identityRead({
        input,
        parse: parseChannels,
        path: "v1/followed-content/channels",
        read,
      }),
    readVideos: (read) =>
      recordedRead({
        input,
        parse: parseVideos,
        path: "v1/followed-content/videos",
        read,
      }),
    readClips: (read) =>
      recordedRead({
        input,
        parse: parseClips,
        path: "v1/followed-content/clips",
        read,
      }),
  } satisfies FollowedContentReader;
}

async function identityRead<T>(options: {
  readonly input: Parameters<typeof createRelayFollowedContentReader>[0];
  readonly parse: (
    platform: Platform,
    value: unknown,
  ) => FollowedReadOutcome<T> | null;
  readonly path: string;
  readonly read: {
    readonly platform: Platform;
    readonly refs: readonly FollowedIdentityRef[];
    readonly signal?: AbortSignal;
  };
}): Promise<FollowedReadOutcome<T>> {
  const blocked = await blockedRead<T>(options.input, options.read);
  if (blocked) return blocked;
  const url = new URL(options.path, options.input.baseUrl);
  url.searchParams.set("platform", options.read.platform);
  for (const ref of options.read.refs) {
    url.searchParams.append(ref.kind === "id" ? "id" : "login", ref.value);
  }
  return fetchOutcome({
    failed: () => failedRead(options.read.platform),
    input: options.input,
    parse: (value) => options.parse(options.read.platform, value),
    read: options.read,
    url,
  });
}

async function recordedRead<T>(options: {
  readonly input: Parameters<typeof createRelayFollowedContentReader>[0];
  readonly parse: (
    platform: Platform,
    channelId: string,
    value: unknown,
  ) => FollowedRecordedOutcome<T> | null;
  readonly path: string;
  readonly read: {
    readonly platform: Platform;
    readonly channelId: string;
    readonly sort: FollowedRecordedSort;
    readonly period?: FollowedClipPeriod;
    readonly signal?: AbortSignal;
  };
}): Promise<FollowedRecordedOutcome<T>> {
  const blocked = await blockedRecorded<T>(options.input, options.read);
  if (blocked) return blocked;
  const url = new URL(options.path, options.input.baseUrl);
  url.searchParams.set("platform", options.read.platform);
  url.searchParams.set("channelId", options.read.channelId);
  url.searchParams.set("sort", options.read.sort);
  if (options.read.period !== undefined) {
    url.searchParams.set("period", options.read.period);
  }
  return fetchOutcome({
    failed: () => failedRecorded(options.read.platform, options.read.channelId),
    input: options.input,
    parse: (value) =>
      options.parse(options.read.platform, options.read.channelId, value),
    read: options.read,
    url,
  });
}

async function fetchOutcome<T>(options: {
  readonly failed: () => T;
  readonly input: Parameters<typeof createRelayFollowedContentReader>[0];
  readonly parse: (value: unknown) => T | null;
  readonly read: { readonly signal?: AbortSignal };
  readonly url: URL;
}): Promise<T> {
  const identity = await options.input.installation();
  if (identity.kind !== "ready") return options.failed();
  try {
    const response = await options.input.fetch(
      options.url.toString(),
      requestInit(
        { Authorization: `Bearer ${identity.credential}` },
        options.read.signal,
      ),
    );
    const parsed = options.parse(await response.json());
    return parsed ?? options.failed();
  } catch (error) {
    if (options.read.signal?.aborted || isAbort(error)) return options.failed();
    return options.failed();
  }
}

async function blockedRead<T>(
  input: Parameters<typeof createRelayFollowedContentReader>[0],
  read: { readonly platform: Platform; readonly signal?: AbortSignal },
): Promise<FollowedReadOutcome<T> | null> {
  if (read.signal?.aborted) return failedRead(read.platform, true);
  if ((await input.network()) === "offline") {
    return { ...failedRead(read.platform), offline: true };
  }
  return null;
}

async function blockedRecorded<T>(
  input: Parameters<typeof createRelayFollowedContentReader>[0],
  read: {
    readonly platform: Platform;
    readonly channelId: string;
    readonly signal?: AbortSignal;
  },
): Promise<FollowedRecordedOutcome<T> | null> {
  if (read.signal?.aborted) {
    return failedRecorded(read.platform, read.channelId);
  }
  if ((await input.network()) === "offline") {
    return { ...failedRecorded(read.platform, read.channelId), offline: true };
  }
  return null;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
