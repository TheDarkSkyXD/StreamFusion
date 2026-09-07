import type { AuthToken, TwitchUser } from "@shared/auth-types";
import type { AuthStatus } from "@shared/ipc-channels";
import { Platform } from "@streamfusion/core/platform";

export interface ResolveAuthStatusDependencies {
  getTwitchUser: () => TwitchUser | null;
  getTwitchToken: () => AuthToken | null;
  getKickUser: () => AuthStatus["kick"]["user"];
  hasUsableToken: (platform: Platform) => boolean;
  isTokenExpired: (platform: Platform) => boolean;
  fetchMissingTwitchUser: () => Promise<TwitchUser | null>;
}

/** Keeps identity fetches single-flight and discards results for rotated tokens. */
export function createTwitchIdentitySingleFlight(
  getCurrentAccessToken: () => string | null,
  fetchCurrentUser: (accessToken: string) => Promise<TwitchUser | null>
): () => Promise<TwitchUser | null> {
  let inFlight: { accessToken: string; promise: Promise<TwitchUser | null> } | null = null;
  return () => {
    const accessToken = getCurrentAccessToken();
    if (!accessToken) return Promise.resolve(null);
    if (!inFlight || inFlight.accessToken !== accessToken) {
      const requestedAccessToken = accessToken;
      const promise = fetchCurrentUser(requestedAccessToken)
        .then((user) => (getCurrentAccessToken() === requestedAccessToken ? user : null))
        .finally(() => {
          if (inFlight?.accessToken === requestedAccessToken) inFlight = null;
        });
      inFlight = { accessToken: requestedAccessToken, promise };
    }
    return inFlight.promise;
  };
}

/** Computes connection state from injected credentials and identity readers. */
export async function resolveAuthStatus(
  dependencies: ResolveAuthStatusDependencies
): Promise<AuthStatus> {
  let twitchUser = dependencies.getTwitchUser();
  const twitchToken = dependencies.getTwitchToken();
  const kickUser = dependencies.getKickUser();
  let twitchHasToken = dependencies.hasUsableToken("twitch");
  const kickHasToken = dependencies.hasUsableToken("kick");
  let twitchExpired = !twitchHasToken || dependencies.isTokenExpired("twitch");
  const kickExpired = !kickHasToken || dependencies.isTokenExpired("kick");

  if (!twitchUser && twitchHasToken && !twitchExpired) {
    twitchUser = await dependencies.fetchMissingTwitchUser();
    if (dependencies.getTwitchToken()?.accessToken !== twitchToken?.accessToken) {
      twitchUser = dependencies.getTwitchUser();
      twitchHasToken = dependencies.hasUsableToken("twitch");
      twitchExpired = !twitchHasToken || dependencies.isTokenExpired("twitch");
    }
  }

  return {
    twitch: {
      connected: !!twitchUser && twitchHasToken && !twitchExpired,
      user: twitchUser,
      hasToken: twitchHasToken,
      isExpired: twitchExpired,
    },
    kick: {
      connected: !!kickUser && kickHasToken && !kickExpired,
      user: kickUser,
      hasToken: kickHasToken,
      isExpired: kickExpired,
    },
    isGuest: !twitchUser && !kickUser,
  };
}
