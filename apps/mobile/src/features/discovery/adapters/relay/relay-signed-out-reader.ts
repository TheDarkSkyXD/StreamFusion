import {
  relayResponseEnvelopeSchema,
  signedOutCategoriesBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema,
  type SignedOutCategoriesBody,
  type SignedOutSearchBody,
  type SignedOutTopStreamsBody,
} from "@streamfusion/core/relay";
import type { Category, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  InstallationIdentityRead,
  PlatformReadOutcome,
  SearchReadOutcome,
} from "../../capabilities/platform-reads";
import {
  emptySearchCatalog,
  streamsFromLiveChannels,
} from "../../domain/search-catalog";
import { requestInit } from "../../utils/optional";

export function createRelaySignedOutReader(input: {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly installation: () => Promise<InstallationIdentityRead>;
}) {
  return {
    async getCategories(inputRead: {
      readonly platform: Platform;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      return relayRead({
        input,
        inputRead,
        parse: relayCategoriesOutcome,
        path: "v1/discovery/categories",
      });
    },
    async getFollowedStreams(inputRead: {
      readonly platform: Platform;
    }): Promise<PlatformReadOutcome<Stream>> {
      return {
        cache: { kind: "miss" },
        error: { code: "signed-out-login-required", retry: "manual" },
        items: [],
        path: {
          kind: "unavailable",
          platform: inputRead.platform,
          reason: "signed-out-login-required",
        },
        platform: inputRead.platform,
        status: "failed",
      };
    },
    async search(inputRead: {
      readonly platform: Platform;
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<SearchReadOutcome> {
      return relaySearchRead({
        input,
        query: inputRead.query,
        platform: inputRead.platform,
        ...(inputRead.signal === undefined ? {} : { signal: inputRead.signal }),
      });
    },
    async getTopStreams(inputRead: {
      readonly platform: Platform;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream>> {
      return relayRead({
        input,
        inputRead,
        parse: relayTopStreamsOutcome,
        path: "v1/discovery/top-streams",
      });
    },
  };
}

async function relayRead<T>(options: {
  readonly input: {
    readonly baseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly installation: () => Promise<InstallationIdentityRead>;
  };
  readonly inputRead: {
    readonly platform: Platform;
    readonly signal?: AbortSignal;
  };
  readonly parse: (platform: Platform, value: unknown) => PlatformReadOutcome<T>;
  readonly path: string;
}): Promise<PlatformReadOutcome<T>> {
  if (options.inputRead.signal?.aborted) {
    return cancelled(options.inputRead.platform);
  }
  const identity = await options.input.installation();
  if (identity.kind !== "ready") {
    return {
      cache: { kind: "miss" },
      error: { code: "signed-out-login-required", retry: "manual" },
      items: [],
      path: {
        kind: "unavailable",
        platform: options.inputRead.platform,
        reason: "signed-out-login-required",
      },
      platform: options.inputRead.platform,
      status: "failed",
    };
  }
  try {
    const url = new URL(options.path, options.input.baseUrl);
    url.searchParams.set("platform", options.inputRead.platform);
    const response = await options.input.fetch(
      url.toString(),
      requestInit(
        { Authorization: `Bearer ${identity.credential}` },
        options.inputRead.signal,
      ),
    );
    return options.parse(options.inputRead.platform, await response.json());
  } catch (error) {
    if (options.inputRead.signal?.aborted || isAbort(error)) {
      return cancelled(options.inputRead.platform);
    }
    return relayFailed(options.inputRead.platform);
  }
}

function relayCategoriesOutcome(
  platform: Platform,
  value: unknown,
): PlatformReadOutcome<Category> {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutCategoriesBodySchema.is(value.outcome.body)
  ) {
    return relayFailed(platform);
  }
  const body: SignedOutCategoriesBody = value.outcome.body;
  return {
    cache: { kind: "miss" },
    items: body.categories,
    path: { kind: "relay", platform },
    platform,
    status: "complete",
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
  };
}

async function relaySearchRead(options: {
  readonly input: {
    readonly baseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly installation: () => Promise<InstallationIdentityRead>;
  };
  readonly platform: Platform;
  readonly query: string;
  readonly signal?: AbortSignal;
}): Promise<SearchReadOutcome> {
  if (options.signal?.aborted) {
    return {
      cache: { kind: "miss" },
      catalog: emptySearchCatalog(),
      error: { code: "cancelled", retry: "none" },
      path: { kind: "unavailable", platform: options.platform, reason: "cancelled" },
      platform: options.platform,
      status: "failed",
    };
  }
  const identity = await options.input.installation();
  if (identity.kind !== "ready") {
    return {
      cache: { kind: "miss" },
      catalog: emptySearchCatalog(),
      error: { code: "signed-out-login-required", retry: "manual" },
      path: {
        kind: "unavailable",
        platform: options.platform,
        reason: "signed-out-login-required",
      },
      platform: options.platform,
      status: "failed",
    };
  }
  try {
    const url = new URL(
      `v1/discovery/search?query=${encodeURIComponent(options.query)}`,
      options.input.baseUrl,
    );
    url.searchParams.set("platform", options.platform);
    const response = await options.input.fetch(
      url.toString(),
      requestInit(
        { Authorization: `Bearer ${identity.credential}` },
        options.signal,
      ),
    );
    return relaySearchOutcome(
      options.platform,
      options.query,
      await response.json(),
    );
  } catch (error) {
    if (options.signal?.aborted || isAbort(error)) {
      return {
        cache: { kind: "miss" },
        catalog: emptySearchCatalog(),
        error: { code: "cancelled", retry: "none" },
        path: {
          kind: "unavailable",
          platform: options.platform,
          reason: "cancelled",
        },
        platform: options.platform,
        status: "failed",
      };
    }
    return searchFailed(options.platform);
  }
}

function relaySearchOutcome(
  platform: Platform,
  query: string,
  value: unknown,
): SearchReadOutcome {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutSearchBodySchema.is(value.outcome.body)
  ) {
    return searchFailed(platform);
  }
  const body: SignedOutSearchBody = value.outcome.body;
  if (body.query !== query) return searchFailed(platform);
  const streams =
    body.streams.length > 0
      ? body.streams
      : streamsFromLiveChannels(body.channels);
  return {
    cache: { kind: "miss" },
    catalog: {
      categories: body.categories,
      channels: body.channels,
      clips: body.clips,
      streams,
      videos: body.videos,
    },
    path: { kind: "relay", platform },
    platform,
    status: "complete",
  };
}

function searchFailed(platform: Platform): SearchReadOutcome {
  return {
    cache: { kind: "miss" },
    catalog: emptySearchCatalog(),
    error: { code: "relay-unavailable", retry: "manual" },
    path: { kind: "unavailable", platform, reason: "relay-unavailable" },
    platform,
    status: "failed",
  };
}

function relayFailed<T>(platform: Platform): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code: "relay-unavailable", retry: "manual" },
    items: [],
    path: { kind: "unavailable", platform, reason: "relay-unavailable" },
    platform,
    status: "failed",
  };
}

function relayTopStreamsOutcome(
  platform: Platform,
  value: unknown,
): PlatformReadOutcome<Stream> {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutTopStreamsBodySchema.is(value.outcome.body)
  ) {
    return {
      cache: { kind: "miss" },
      error: { code: "relay-unavailable", retry: "manual" },
      items: [],
      path: { kind: "unavailable", platform, reason: "relay-unavailable" },
      platform,
      status: "failed",
    };
  }
  const body: SignedOutTopStreamsBody = value.outcome.body;
  return {
    cache: { kind: "miss" },
    items: body.streams,
    path: { kind: "relay", platform },
    platform,
    status: "complete",
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
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

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
