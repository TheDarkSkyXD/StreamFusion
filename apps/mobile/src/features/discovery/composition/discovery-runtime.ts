import type { Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createRelaySignedOutReader } from "../adapters/relay/relay-signed-out-reader";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import type {
  DiscoveryRuntime,
  InstallationIdentityRead,
  InstallationIdentitySource,
  NetworkRead,
  NetworkSource,
  PlatformReadOutcome,
  PlatformReadPath,
  UserTokenRead,
  UserTokenSource,
} from "../capabilities/platform-reads";
import { createDiscoveryCacheStore } from "../data/cache-discovery-store";
import { selectPlatformReadPath } from "../domain/platform-read-path";
import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";

import { readSearchCatalog } from "./search-runtime";

const AUTOMATIC_RETRY_CODES = new Set([
  "kick-failed",
  "relay-unavailable",
  "twitch-failed",
]);

export function createDiscoveryRuntime(input: {
  readonly cache: DisposableCache;
  readonly fetch?: typeof globalThis.fetch;
  readonly installation: InstallationIdentitySource;
  readonly kickAccessToken: () => Promise<string | null>;
  readonly network: NetworkSource;
  readonly relayBaseUrl: string;
  readonly twitchClientId: string | null;
  readonly userTokens: UserTokenSource;
}): DiscoveryRuntime {
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

  return {
    async readTopStreams(read) {
      if (read.signal?.aborted) return cancelled(read.platform);
      const userToken = await input.userTokens.read(read.platform);
      const installation = await input.installation.read();
      const network = await input.network.read();
      const path = selectPlatformReadPath({
        installation,
        network,
        platform: read.platform,
        userToken,
      });
      const pathInput = {
        installation,
        kick,
        path,
        relay,
        twitch,
        ...(read.language === undefined ? {} : { language: read.language }),
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      };
      const first = await readAlongPath(pathInput);
      const retried =
        shouldRetryOnce(first) && read.signal?.aborted !== true
          ? await readAlongPath(pathInput)
          : first;
      const annotated = annotateAuthLost(retried, userToken);
      if (annotated.status === "complete" || annotated.status === "partial") {
        if (annotated.items.length > 0) {
          await cache.writeTopStreams({
            items: annotated.items,
            platform: read.platform,
            ...(read.language === undefined ? {} : { language: read.language }),
            ...(annotated.cursor === undefined
              ? {}
              : { cursor: annotated.cursor }),
          });
        }
        return annotated;
      }
      return withCacheFallback({
        cache,
        outcome: annotated,
        path,
        platform: read.platform,
        ...(read.language === undefined ? {} : { language: read.language }),
      });
    },
    async search(read) {
      const userToken = await input.userTokens.read(read.platform);
      const installation = await input.installation.read();
      const network = await input.network.read();
      return readSearchCatalog({
        cache,
        installation,
        kick,
        network,
        platform: read.platform,
        query: read.query,
        relay,
        twitch,
        userToken,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
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
  readonly state?: { readonly credential: { readonly credential: string } | null };
}): InstallationIdentityRead {
  if (read.kind === "ready" && read.state?.credential) {
    return { credential: read.state.credential.credential, kind: "ready" };
  }
  return { kind: "none" };
}

export function alwaysOnlineNetwork(): NetworkSource {
  return { read: async () => "online" };
}

async function readAlongPath(input: {
  readonly installation: InstallationIdentityRead;
  readonly kick: ReturnType<typeof createKickOfficialReader>;
  readonly language?: string;
  readonly path: PlatformReadPath;
  readonly relay: ReturnType<typeof createRelaySignedOutReader>;
  readonly signal?: AbortSignal;
  readonly twitch: ReturnType<typeof createTwitchHelixReader>;
}): Promise<PlatformReadOutcome<Stream>> {
  if (input.path.kind === "unavailable") {
    return unavailableOutcome(input.path);
  }
  if (input.path.kind === "direct") {
    const direct =
      input.path.platform === "twitch"
        ? await input.twitch.getTopStreams({
            ...(input.language === undefined ? {} : { language: input.language }),
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
        : await input.kick.getTopStreams(
            input.signal === undefined ? {} : { signal: input.signal },
          );
    if (
      direct.error?.code === "auth-lost" &&
      input.installation.kind === "ready"
    ) {
      const relayed = await input.relay.getTopStreams({
        platform: input.path.platform,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (relayed.status === "complete" || relayed.status === "partial") {
        return {
          ...relayed,
          error: { code: "auth-lost", retry: "manual" },
          status: "partial",
        };
      }
    }
    return direct;
  }
  return input.relay.getTopStreams({
    platform: input.path.platform,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

async function withCacheFallback(input: {
  readonly cache: ReturnType<typeof createDiscoveryCacheStore>;
  readonly language?: string;
  readonly outcome: PlatformReadOutcome<Stream>;
  readonly path: PlatformReadPath;
  readonly platform: Platform;
}): Promise<PlatformReadOutcome<Stream>> {
  const stored = await input.cache.readTopStreams(
    input.platform,
    input.language,
  );
  if (stored.kind === "miss") return input.outcome;
  return {
    cache: stored.cache,
    items: stored.items,
    path: input.path,
    platform: input.platform,
    status: "stale",
    ...(stored.cursor === undefined ? {} : { cursor: stored.cursor }),
    ...(input.outcome.error === undefined ? {} : { error: input.outcome.error }),
  };
}

function annotateAuthLost(
  outcome: PlatformReadOutcome<Stream>,
  userToken: UserTokenRead,
): PlatformReadOutcome<Stream> {
  if (userToken.kind !== "auth-lost" || outcome.status === "failed") {
    return outcome;
  }
  return {
    ...outcome,
    error: { code: "auth-lost", retry: "manual" },
    status: "partial",
  };
}

function shouldRetryOnce(outcome: PlatformReadOutcome<Stream>): boolean {
  return (
    outcome.status === "failed" &&
    outcome.error !== undefined &&
    AUTOMATIC_RETRY_CODES.has(outcome.error.code)
  );
}

function unavailableOutcome(
  path: Extract<PlatformReadPath, { kind: "unavailable" }>,
): PlatformReadOutcome<Stream> {
  return {
    cache: { kind: "miss" },
    error: { code: path.reason, retry: path.reason === "cancelled" ? "none" : "manual" },
    items: [],
    path,
    platform: path.platform,
    status: "failed",
  };
}

function cancelled(platform: Platform): PlatformReadOutcome<Stream> {
  return unavailableOutcome({ kind: "unavailable", platform, reason: "cancelled" });
}

export type { NetworkRead };
