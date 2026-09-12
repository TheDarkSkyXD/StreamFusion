import type { Clip, Video } from "@streamfusion/core/content";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import type { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import type { createRelaySignedOutReader } from "../adapters/relay/relay-signed-out-reader";
import type { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import type {
  ChannelMediaRead,
  ChannelPageOutcome,
  DiscoverySession,
  InstallationIdentitySource,
  NetworkSource,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import { createChannelCacheStore } from "../data/cache-channel-store";
import { unsupportedMedia } from "../domain/channel-detail";
import {
  cancelled,
  executeChannelRead,
  executePlatformRead,
  staleFromCache,
} from "./execute-platform-read";

type Readers = {
  readonly kick: ReturnType<typeof createKickOfficialReader>;
  readonly relay: ReturnType<typeof createRelaySignedOutReader>;
  readonly twitch: ReturnType<typeof createTwitchHelixReader>;
};

export function createChannelDiscoverySession(input: {
  readonly cache: Parameters<typeof createChannelCacheStore>[0];
  readonly installation: InstallationIdentitySource;
  readonly network: NetworkSource;
  readonly readers: Readers;
}): Pick<
  DiscoverySession,
  "readChannel" | "readChannelClips" | "readChannelVideos"
> {
  const cache = createChannelCacheStore(input.cache);
  return {
    async readChannel(read) {
      const context = await readContext(input, read.signal);
      if (context === null) return cancelledChannel(read.channel.platform);
      return executeChannelRead({
        cacheFallback: (failed, path) =>
          withChannelCache(cache, read.channel, failed, path),
        cacheWrite: async (page) => {
          if (page.channel === null) return;
          await cache.writeChannel({
            channel: read.channel,
            item: page.channel,
            live: page.live,
          });
        },
        installation: context.installation,
        network: context.network,
        platform: read.channel.platform,
        readDirect: () =>
          directChannel(input.readers, read.channel, read.signal),
        readRelay: () =>
          input.readers.relay.getChannel({
            channel: read.channel,
            ...(read.signal === undefined ? {} : { signal: read.signal }),
          }),
        ...(read.signal === undefined ? {} : { signal: read.signal }),
        userToken: context.userToken,
      });
    },
    async readChannelVideos(read) {
      if (read.channel.platform === "kick") {
        return unsupportedMedia("kick", "videos");
      }
      return {
        kind: "page",
        outcome: await readVideos(input, cache, read),
      };
    },
    async readChannelClips(read) {
      if (read.channel.platform === "kick") {
        return unsupportedMedia("kick", "clips");
      }
      return {
        kind: "page",
        outcome: await readClips(input, cache, read),
      };
    },
  };
}

async function readVideos(
  input: {
    readonly installation: InstallationIdentitySource;
    readonly network: NetworkSource;
    readonly readers: Readers;
  },
  cache: ReturnType<typeof createChannelCacheStore>,
  read: { readonly channel: ChannelIdentity; readonly signal?: AbortSignal },
): Promise<PlatformReadOutcome<Video>> {
  const context = await readContext(input, read.signal);
  if (context === null) return cancelled(read.channel.platform);
  return executePlatformRead({
    cacheFallback: async (failed, path) => {
      const stored = await cache.readVideos(read.channel);
      if (stored.kind === "miss") return failed;
      return staleFromCache({
        cache: stored.cache,
        items: stored.items,
        path,
        platform: read.channel.platform,
        ...(failed.error === undefined ? {} : { error: failed.error }),
      });
    },
    cacheWrite: (outcome) =>
      cache.writeVideos({ channel: read.channel, items: outcome.items }),
    installation: context.installation,
    network: context.network,
    platform: read.channel.platform,
    readDirect: () =>
      input.readers.twitch.getChannelVideos({
        channel: read.channel,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      }),
    readRelay: () =>
      input.readers.relay.getChannelVideos({
        channel: read.channel,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      }),
    ...(read.signal === undefined ? {} : { signal: read.signal }),
    userToken: context.userToken,
  });
}

async function readClips(
  input: {
    readonly installation: InstallationIdentitySource;
    readonly network: NetworkSource;
    readonly readers: Readers;
  },
  cache: ReturnType<typeof createChannelCacheStore>,
  read: { readonly channel: ChannelIdentity; readonly signal?: AbortSignal },
): Promise<PlatformReadOutcome<Clip>> {
  const context = await readContext(input, read.signal);
  if (context === null) return cancelled(read.channel.platform);
  return executePlatformRead({
    cacheFallback: async (failed, path) => {
      const stored = await cache.readClips(read.channel);
      if (stored.kind === "miss") return failed;
      return staleFromCache({
        cache: stored.cache,
        items: stored.items,
        path,
        platform: read.channel.platform,
        ...(failed.error === undefined ? {} : { error: failed.error }),
      });
    },
    cacheWrite: (outcome) =>
      cache.writeClips({ channel: read.channel, items: outcome.items }),
    installation: context.installation,
    network: context.network,
    platform: read.channel.platform,
    readDirect: () =>
      input.readers.twitch.getChannelClips({
        channel: read.channel,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      }),
    readRelay: () =>
      input.readers.relay.getChannelClips({
        channel: read.channel,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      }),
    ...(read.signal === undefined ? {} : { signal: read.signal }),
    userToken: context.userToken,
  });
}

async function readContext(
  input: {
    readonly installation: InstallationIdentitySource;
    readonly network: NetworkSource;
  },
  signal?: AbortSignal,
) {
  if (signal?.aborted) return null;
  const [installation, network] = await Promise.all([
    input.installation.read(),
    input.network.read(),
  ]);
  return { installation, network, userToken: { kind: "none" as const } };
}

function directChannel(
  readers: Readers,
  channel: ChannelIdentity,
  signal?: AbortSignal,
): Promise<ChannelPageOutcome> {
  const read = {
    channel,
    ...(signal === undefined ? {} : { signal }),
  };
  return channel.platform === "twitch"
    ? readers.twitch.getChannel(read)
    : readers.kick.getChannel(read);
}

async function withChannelCache(
  cache: ReturnType<typeof createChannelCacheStore>,
  channel: ChannelIdentity,
  outcome: ChannelPageOutcome,
  path: ChannelPageOutcome["path"],
): Promise<ChannelPageOutcome> {
  const stored = await cache.readChannel(channel);
  if (stored.kind === "miss") return outcome;
  return {
    cache: stored.cache,
    channel: stored.value.item,
    live: stored.value.live,
    path,
    platform: channel.platform,
    status: "stale",
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  };
}

function cancelledChannel(platform: Platform): ChannelPageOutcome {
  return {
    cache: { kind: "miss" },
    channel: null,
    error: { code: "cancelled", retry: "none" },
    live: null,
    path: { kind: "unavailable", platform, reason: "cancelled" },
    platform,
    status: "failed",
  };
}

export type { ChannelMediaRead };
