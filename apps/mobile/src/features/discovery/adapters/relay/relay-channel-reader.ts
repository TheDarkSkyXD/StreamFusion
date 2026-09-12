import {
  relayResponseEnvelopeSchema,
  signedOutChannelBodySchema,
  signedOutClipsBodySchema,
  signedOutVideosBodySchema,
} from "@streamfusion/core/relay";
import type { Clip, Video } from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import type {
  ChannelPageOutcome,
  InstallationIdentityRead,
  PlatformReadOutcome,
} from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";

export function createRelayChannelReader(input: {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly installation: () => Promise<InstallationIdentityRead>;
}) {
  return {
    async getChannel(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<ChannelPageOutcome> {
      const parsed = await relayJson(input, "v1/discovery/channel", read);
      if (parsed.kind === "failed") return failedPage(read.channel.platform, parsed.code);
      if (
        !relayResponseEnvelopeSchema.is(parsed.value) ||
        parsed.value.outcome.kind !== "success" ||
        !signedOutChannelBodySchema.is(parsed.value.outcome.body)
      ) {
        return failedPage(read.channel.platform, "relay-unavailable");
      }
      const body = parsed.value.outcome.body;
      return {
        cache: { kind: "miss" },
        channel: body.channel,
        live: body.live,
        path: { kind: "relay", platform: read.channel.platform },
        platform: read.channel.platform,
        status: "complete",
      };
    },
    async getChannelVideos(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Video>> {
      const parsed = await relayJson(input, "v1/discovery/channel-videos", read);
      if (parsed.kind === "failed") {
        return failedCollection(read.channel.platform, parsed.code);
      }
      if (
        !relayResponseEnvelopeSchema.is(parsed.value) ||
        parsed.value.outcome.kind !== "success" ||
        !signedOutVideosBodySchema.is(parsed.value.outcome.body)
      ) {
        return failedCollection(read.channel.platform, "relay-unavailable");
      }
      const body = parsed.value.outcome.body;
      if (body.support === "unsupported") {
        return failedCollection(read.channel.platform, "unsupported");
      }
      return {
        cache: { kind: "miss" },
        items: body.videos,
        path: { kind: "relay", platform: read.channel.platform },
        platform: read.channel.platform,
        status: "complete",
        ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
      };
    },
    async getChannelClips(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Clip>> {
      const parsed = await relayJson(input, "v1/discovery/channel-clips", read);
      if (parsed.kind === "failed") {
        return failedCollection(read.channel.platform, parsed.code);
      }
      if (
        !relayResponseEnvelopeSchema.is(parsed.value) ||
        parsed.value.outcome.kind !== "success" ||
        !signedOutClipsBodySchema.is(parsed.value.outcome.body)
      ) {
        return failedCollection(read.channel.platform, "relay-unavailable");
      }
      const body = parsed.value.outcome.body;
      if (body.support === "unsupported") {
        return failedCollection(read.channel.platform, "unsupported");
      }
      return {
        cache: { kind: "miss" },
        items: body.clips,
        path: { kind: "relay", platform: read.channel.platform },
        platform: read.channel.platform,
        status: "complete",
        ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
      };
    },
  };
}

async function relayJson(
  input: {
    readonly baseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly installation: () => Promise<InstallationIdentityRead>;
  },
  path: string,
  read: { readonly channel: ChannelIdentity; readonly signal?: AbortSignal },
): Promise<
  | { readonly kind: "ready"; readonly value: unknown }
  | { readonly kind: "failed"; readonly code: string }
> {
  if (read.signal?.aborted) return { code: "cancelled", kind: "failed" };
  const identity = await input.installation();
  try {
    const url = new URL(path, input.baseUrl);
    url.searchParams.set("platform", read.channel.platform);
    if (read.channel.id !== "") url.searchParams.set("id", read.channel.id);
    if (read.channel.username !== "") {
      url.searchParams.set("login", read.channel.username);
    }
    const response = await input.fetch(
      url.toString(),
      requestInit(
        identity.kind === "ready"
          ? { Authorization: `Bearer ${identity.credential}` }
          : {},
        read.signal,
      ),
    );
    return { kind: "ready", value: await response.json() };
  } catch {
    return {
      code: read.signal?.aborted ? "cancelled" : "relay-unavailable",
      kind: "failed",
    };
  }
}

function failedPage(
  platform: ChannelIdentity["platform"],
  code: string,
): ChannelPageOutcome {
  return {
    cache: { kind: "miss" },
    channel: null,
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    live: null,
    path: unavailablePath(platform, code),
    platform,
    status: "failed",
  };
}

function failedCollection<T>(
  platform: ChannelIdentity["platform"],
  code: string,
): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path: unavailablePath(platform, code),
    platform,
    status: "failed",
  };
}

function unavailablePath(
  platform: ChannelIdentity["platform"],
  code: string,
): PlatformReadOutcome<never>["path"] {
  if (code === "cancelled") {
    return { kind: "unavailable", platform, reason: "cancelled" };
  }
  if (code === "signed-out-login-required") {
    return { kind: "unavailable", platform, reason: "signed-out-login-required" };
  }
  return { kind: "unavailable", platform, reason: "relay-unavailable" };
}
