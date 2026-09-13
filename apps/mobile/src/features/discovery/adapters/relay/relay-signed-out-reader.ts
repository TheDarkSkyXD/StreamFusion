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
import { createRelayChannelReader } from "./relay-channel-reader";
import {
  createRelayCategoryReads,
  relayRead,
} from "./relay-signed-out-category-reader";

export function createRelaySignedOutReader(input: {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly installation: () => Promise<InstallationIdentityRead>;
}) {
  return {
    ...createRelayChannelReader(input),
    ...createRelayCategoryReads(input),
    async getCategories(inputRead: {
      readonly platform: Platform;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      return relayRead({
        input,
        parse: relayCategoriesOutcome,
        path: "v1/discovery/categories",
        platform: inputRead.platform,
        ...(inputRead.signal === undefined ? {} : { signal: inputRead.signal }),
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
    async searchCategories(inputRead: {
      readonly platform: Platform;
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      return relayRead({
        input,
        params: { q: inputRead.query },
        parse: relaySearchCategoriesOutcome,
        path: "v1/discovery/search",
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
        parse: relayTopStreamsOutcome,
        path: "v1/discovery/top-streams",
        platform: inputRead.platform,
        ...(inputRead.signal === undefined ? {} : { signal: inputRead.signal }),
      });
    },
  };
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
      path: {
        kind: "unavailable",
        platform: options.platform,
        reason: "cancelled",
      },
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
    const url = new URL("v1/discovery/search", options.input.baseUrl);
    url.searchParams.set("platform", options.platform);
    url.searchParams.set("query", options.query);
    const response = await options.input.fetch(
      url.toString(),
      requestInit(
        { Authorization: `Bearer ${identity.credential}` },
        options.signal,
      ),
    );
    return catalogFromSearchValue(
      options.platform,
      options.query,
      await response.json(),
    );
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
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
    return {
      cache: { kind: "miss" },
      catalog: emptySearchCatalog(),
      error: { code: "relay-unavailable", retry: "manual" },
      path: {
        kind: "unavailable",
        platform: options.platform,
        reason: "relay-unavailable",
      },
      platform: options.platform,
      status: "failed",
    };
  }
}

function catalogFromSearchValue(
  platform: Platform,
  query: string,
  value: unknown,
): SearchReadOutcome {
  const body = searchBody(platform, query, value);
  if (body === null) {
    return {
      cache: { kind: "miss" },
      catalog: emptySearchCatalog(),
      error: { code: "relay-unavailable", retry: "manual" },
      path: { kind: "unavailable", platform, reason: "relay-unavailable" },
      platform,
      status: "failed",
    };
  }
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

function relaySearchCategoriesOutcome(
  platform: Platform,
  value: unknown,
): PlatformReadOutcome<Category> {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutSearchBodySchema.is(value.outcome.body)
  ) {
    return relayFailed(platform);
  }
  return {
    cache: { kind: "miss" },
    items: value.outcome.body.categories,
    path: { kind: "relay", platform },
    platform,
    status: "complete",
  };
}

function searchBody(
  platform: Platform,
  query: string,
  value: unknown,
): SignedOutSearchBody | null {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutSearchBodySchema.is(value.outcome.body)
  ) {
    return null;
  }
  return value.outcome.body.query === query ? value.outcome.body : null;
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
    return relayFailed(platform);
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
