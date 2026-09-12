import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import type { ClipTimeRange } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

import type {
  InstallationIdentityRead,
  PlatformReadOutcome,
} from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";

import {
  cancelled,
  relayCategoryClipsOutcome,
  relayCategoryOutcome,
  relayCategoryStreamsOutcome,
  relayCategoryVideosOutcome,
  relayFailed,
} from "./relay-category-parse";

type RelayInput = {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly installation: () => Promise<InstallationIdentityRead>;
};

export function createRelayCategoryReads(input: RelayInput) {
  return {
    async getCategory(read: {
      readonly categoryId: string;
      readonly platform: Platform;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      return relayRead({
        input,
        params: { categoryId: read.categoryId },
        parse: relayCategoryOutcome,
        path: "v1/discovery/category",
        platform: read.platform,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryStreams(read: {
      readonly categoryId: string;
      readonly language?: string;
      readonly platform: Platform;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream>> {
      return relayRead({
        input,
        params: {
          categoryId: read.categoryId,
          ...(read.language === undefined ? {} : { language: read.language }),
        },
        parse: relayCategoryStreamsOutcome,
        path: "v1/discovery/category-streams",
        platform: read.platform,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryClips(read: {
      readonly categoryId: string;
      readonly platform: Platform;
      readonly signal?: AbortSignal;
      readonly timeRange: ClipTimeRange;
    }): Promise<
      | PlatformReadOutcome<Clip>
      | {
          readonly kind: "unsupported";
          readonly platform: Platform;
          readonly reason: "kick-clips-unsupported";
        }
    > {
      return relayMediaRead({
        input,
        params: { categoryId: read.categoryId, timeRange: read.timeRange },
        parse: relayCategoryClipsOutcome,
        path: "v1/discovery/category-clips",
        platform: read.platform,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryVideos(read: {
      readonly categoryId: string;
      readonly platform: Platform;
      readonly signal?: AbortSignal;
      readonly sort: "views" | "recent";
    }): Promise<
      | PlatformReadOutcome<Video>
      | {
          readonly kind: "unsupported";
          readonly platform: Platform;
          readonly reason: "kick-videos-unsupported";
        }
    > {
      return relayMediaRead({
        input,
        params: { categoryId: read.categoryId, sort: read.sort },
        parse: relayCategoryVideosOutcome,
        path: "v1/discovery/category-videos",
        platform: read.platform,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
  };
}

export async function relayRead<T>(options: {
  readonly input: RelayInput;
  readonly params?: Record<string, string>;
  readonly parse: (platform: Platform, value: unknown) => PlatformReadOutcome<T>;
  readonly path: string;
  readonly platform: Platform;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<T>> {
  const result = await relayRaw<T>(options);
  if (result.kind === "outcome") return result.outcome;
  return options.parse(options.platform, result.value);
}

async function relayMediaRead<T, TUnsupported>(options: {
  readonly input: RelayInput;
  readonly params?: Record<string, string>;
  readonly parse: (
    platform: Platform,
    value: unknown,
  ) => PlatformReadOutcome<T> | TUnsupported;
  readonly path: string;
  readonly platform: Platform;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<T> | TUnsupported> {
  const result = await relayRaw<T>(options);
  if (result.kind === "outcome") return result.outcome;
  return options.parse(options.platform, result.value);
}

async function relayRaw<T>(options: {
  readonly input: RelayInput;
  readonly params?: Record<string, string>;
  readonly path: string;
  readonly platform: Platform;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly kind: "outcome"; readonly outcome: PlatformReadOutcome<T> }
  | { readonly kind: "value"; readonly value: unknown }
> {
  if (options.signal?.aborted) {
    return { kind: "outcome", outcome: cancelled(options.platform) };
  }
  const identity = await options.input.installation();
  if (identity.kind !== "ready") {
    return {
      kind: "outcome",
      outcome: {
        cache: { kind: "miss" },
        error: { code: "signed-out-login-required", retry: "manual" },
        items: [],
        path: {
          kind: "unavailable",
          platform: options.platform,
          reason: "signed-out-login-required",
        },
        platform: options.platform,
        status: "failed",
      },
    };
  }
  try {
    const url = new URL(options.path, options.input.baseUrl);
    url.searchParams.set("platform", options.platform);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value);
    }
    const response = await options.input.fetch(
      url.toString(),
      requestInit(
        { Authorization: `Bearer ${identity.credential}` },
        options.signal,
      ),
    );
    return { kind: "value", value: await response.json() };
  } catch (error) {
    if (options.signal?.aborted || isAbort(error)) {
      return { kind: "outcome", outcome: cancelled(options.platform) };
    }
    return { kind: "outcome", outcome: relayFailed(options.platform) };
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
