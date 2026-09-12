import {
  relayResponseEnvelopeSchema,
  signedOutCategoriesBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema,
  type SignedOutCategoriesBody,
  type SignedOutSearchBody,
  type SignedOutTopStreamsBody,
} from "@streamfusion/core/relay";
import type { Category, Channel, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  InstallationIdentityRead,
  PlatformReadOutcome,
} from "../../capabilities/platform-reads";
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
    }): Promise<PlatformReadOutcome<Stream | Channel | Category>> {
      return relayRead({
        input,
        params: { q: inputRead.query },
        parse: (platform, value) =>
          relaySearchOutcome(platform, inputRead.query, value),
        path: "v1/discovery/search",
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

function relaySearchOutcome(
  platform: Platform,
  query: string,
  value: unknown,
): PlatformReadOutcome<Stream | Channel | Category> {
  const body = searchBody(platform, query, value);
  if (body === null) return relayFailed(platform);
  return {
    cache: { kind: "miss" },
    items: [...body.streams, ...body.channels, ...body.categories],
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
