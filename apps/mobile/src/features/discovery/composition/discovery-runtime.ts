import type { Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createRelaySignedOutReader } from "../adapters/relay/relay-signed-out-reader";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import type {
  DiscoverySession,
  InstallationIdentityRead,
  InstallationIdentitySource,
  NetworkRead,
  NetworkSource,
  PlatformReadOutcome,
  UserTokenRead,
  UserTokenSource,
} from "../capabilities/platform-reads";
import { createDiscoveryCacheStore } from "../data/cache-discovery-store";
import { createChannelDiscoverySession } from "./channel-discovery-runtime";
import { executePlatformRead, staleFromCache } from "./execute-platform-read";

export function createDiscoveryRuntime(input: {
  readonly cache: Parameters<typeof createDiscoveryCacheStore>[0];
  readonly fetch?: typeof globalThis.fetch;
  readonly installation: InstallationIdentitySource;
  readonly kickAccessToken: () => Promise<string | null>;
  readonly network: NetworkSource;
  readonly relayBaseUrl: string;
  readonly twitchClientId: string | null;
  readonly userTokens: UserTokenSource;
}): DiscoverySession {
  const cache = createDiscoveryCacheStore(input.cache);
  const request = input.fetch ?? globalThis.fetch;
  const twitch = createTwitchHelixReader({
    clientId: input.twitchClientId,
    fetch: request,
    readAccessToken: async () => {
      const token = await input.userTokens.read("twitch");
      return token.kind === "ready" ? token.accessToken : null;
    },
  });
  const kick = createKickOfficialReader({
    fetch: request,
    readAccessToken: input.kickAccessToken,
  });
  const relay = createRelaySignedOutReader({
    baseUrl: input.relayBaseUrl,
    fetch: request,
    installation: () => input.installation.read(),
  });
  const readers = { kick, relay, twitch };
  return {
    async readTopStreams(read) {
      const installation = await input.installation.read();
      const network = await input.network.read();
      return executePlatformRead({
        cacheFallback: (outcome, path) =>
          withTopStreamsCache({
            cache,
            outcome,
            path,
            platform: read.platform,
            ...(read.language === undefined ? {} : { language: read.language }),
          }),
        cacheWrite: (outcome) =>
          cache.writeTopStreams({
            items: outcome.items,
            platform: read.platform,
            ...(read.language === undefined ? {} : { language: read.language }),
            ...(outcome.cursor === undefined ? {} : { cursor: outcome.cursor }),
          }),
        installation,
        network,
        platform: read.platform,
        readDirect: () =>
          read.platform === "twitch"
            ? twitch.getTopStreams({
                ...(read.language === undefined
                  ? {}
                  : { language: read.language }),
                ...(read.signal === undefined ? {} : { signal: read.signal }),
              })
            : kick.getTopStreams(
                read.signal === undefined ? {} : { signal: read.signal },
              ),
        readRelay: () =>
          relay.getTopStreams({
            platform: read.platform,
            ...(read.signal === undefined ? {} : { signal: read.signal }),
          }),
        ...(read.signal === undefined ? {} : { signal: read.signal }),
        userToken: { kind: "none" },
      });
    },
    ...createChannelDiscoverySession({
      cache: input.cache,
      installation: input.installation,
      network: input.network,
      readers,
    }),
  };
}

export function userTokenFromTwitchSnapshot(snapshot: {
  readonly kind: string;
  readonly credential?: { readonly accessToken: string };
}): UserTokenRead {
  if (snapshot.kind === "ready" && snapshot.credential) {
    return { accessToken: snapshot.credential.accessToken, kind: "ready" };
  }
  if (snapshot.kind === "auth-lost") return { kind: "auth-lost" };
  return { kind: "none" };
}

export function installationIdentityFromStore(read: {
  readonly kind: string;
  readonly state?: {
    readonly credential: { readonly credential: string } | null;
  };
}): InstallationIdentityRead {
  if (read.kind === "ready" && read.state?.credential) {
    return { credential: read.state.credential.credential, kind: "ready" };
  }
  return { kind: "none" };
}

export function alwaysOnlineNetwork(): NetworkSource {
  return { read: async () => "online" };
}

async function withTopStreamsCache(input: {
  readonly cache: ReturnType<typeof createDiscoveryCacheStore>;
  readonly language?: string;
  readonly outcome: PlatformReadOutcome<Stream>;
  readonly path: PlatformReadOutcome<Stream>["path"];
  readonly platform: Platform;
}): Promise<PlatformReadOutcome<Stream>> {
  const stored = await input.cache.readTopStreams(
    input.platform,
    input.language,
  );
  if (stored.kind === "miss") return input.outcome;
  return staleFromCache({
    cache: stored.cache,
    items: stored.items,
    path: input.path,
    platform: input.platform,
    ...(input.outcome.error === undefined
      ? {}
      : { error: input.outcome.error }),
  });
}

export type { NetworkRead };
