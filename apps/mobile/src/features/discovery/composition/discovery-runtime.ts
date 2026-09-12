import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createRelaySignedOutReader } from "../adapters/relay/relay-signed-out-reader";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import type {
  DiscoverySession,
  InstallationIdentityRead,
  InstallationIdentitySource,
  NetworkSource,
  UserTokenRead,
  UserTokenSource,
} from "../capabilities/platform-reads";
import { createDiscoveryCacheStore } from "../data/cache-discovery-store";

import {
  availableMedia,
  cachedRead,
  liveRead,
  signalOf,
} from "./discovery-session-read";

export function createDiscoveryRuntime(input: {
  readonly cache: DisposableCache;
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
  const sources = { input, kick, relay, twitch };

  return {
    readTopStreams(read) {
      return cachedRead({
        cacheFallback: (platform, language) =>
          cache.readTopStreams(platform, language),
        readDirect: (platform, extra) =>
          platform === "twitch"
            ? twitch.getTopStreams(extra)
            : kick.getTopStreams(extra),
        readRelay: (platform, extra) =>
          relay.getTopStreams({ platform, ...signalOf(extra) }),
        sources,
        writeCache: (outcome, platform, language) =>
          cache.writeTopStreams({
            items: outcome.items,
            platform,
            ...(language === undefined ? {} : { language }),
            ...(outcome.cursor === undefined ? {} : { cursor: outcome.cursor }),
          }),
        ...read,
      });
    },
    readCategories(read) {
      return cachedRead({
        cacheFallback: (platform) => cache.readCategories(platform),
        readDirect: (platform, extra) =>
          platform === "twitch"
            ? twitch.getCategories(extra)
            : kick.getCategories(extra),
        readRelay: (platform, extra) =>
          relay.getCategories({ platform, ...signalOf(extra) }),
        sources,
        writeCache: (outcome, platform) =>
          cache.writeCategories({
            items: outcome.items,
            platform,
            ...(outcome.cursor === undefined ? {} : { cursor: outcome.cursor }),
          }),
        ...read,
      });
    },
    searchCategories(read) {
      return liveRead({
        readDirect: (platform, extra) =>
          platform === "twitch"
            ? twitch.searchCategories({ query: read.query, ...extra })
            : kick.searchCategories({ query: read.query, ...extra }),
        readRelay: (platform, extra) =>
          relay.searchCategories({
            platform,
            query: read.query,
            ...signalOf(extra),
          }),
        sources,
        ...read,
      });
    },
    readCategory(read) {
      return liveRead({
        readDirect: (platform, extra) =>
          platform === "twitch"
            ? twitch.getCategory({ categoryId: read.categoryId, ...extra })
            : kick.getCategory({ categoryId: read.categoryId, ...extra }),
        readRelay: (platform, extra) =>
          relay.getCategory({
            categoryId: read.categoryId,
            platform,
            ...signalOf(extra),
          }),
        sources,
        ...read,
      });
    },
    readCategoryStreams(read) {
      return liveRead({
        readDirect: (platform, extra) =>
          platform === "twitch"
            ? twitch.getCategoryStreams({
                categoryId: read.categoryId,
                ...extra,
                ...(read.language === undefined
                  ? {}
                  : { language: read.language }),
              })
            : kick.getCategoryStreams({
                categoryId: read.categoryId,
                ...extra,
                ...(read.language === undefined
                  ? {}
                  : { language: read.language }),
              }),
        readRelay: (platform, extra) =>
          relay.getCategoryStreams({
            categoryId: read.categoryId,
            platform,
            ...signalOf(extra),
            ...(read.language === undefined ? {} : { language: read.language }),
          }),
        sources,
        ...read,
      });
    },
    async readCategoryClips(read) {
      if (read.platform === "kick") return kick.unsupportedClips();
      return liveRead({
        readDirect: (_platform, extra) =>
          twitch.getCategoryClips({
            categoryId: read.categoryId,
            timeRange: read.timeRange,
            ...extra,
          }),
        readRelay: async (platform, extra) =>
          availableMedia(
            await relay.getCategoryClips({
              categoryId: read.categoryId,
              platform,
              timeRange: read.timeRange,
              ...signalOf(extra),
            }),
          ),
        sources,
        ...read,
      });
    },
    async readCategoryVideos(read) {
      if (read.platform === "kick") return kick.unsupportedVideos();
      return liveRead({
        readDirect: (_platform, extra) =>
          twitch.getCategoryVideos({
            categoryId: read.categoryId,
            sort: read.sort,
            ...extra,
          }),
        readRelay: async (platform, extra) =>
          availableMedia(
            await relay.getCategoryVideos({
              categoryId: read.categoryId,
              platform,
              sort: read.sort,
              ...signalOf(extra),
            }),
          ),
        sources,
        ...read,
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

export type { NetworkRead } from "../capabilities/platform-reads";
