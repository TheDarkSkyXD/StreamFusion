import type { TwitchPlaylistProxyPreferences } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import { resolveTwitchPlaylistProxyAttemptUrls } from "@mobile/features/ad-blocking/domain/twitch-playlist-proxy";

import type { HlsSourceUri, WatchTarget } from "../capabilities/watch";
import type { HlsRequestHeaders } from "./hls-request-headers";
import { asHttpsPlaybackSourceUri } from "./hls-source";

export type PlaylistProxyPlaybackAttempt = {
  readonly requestHeaders: HlsRequestHeaders;
  readonly sourceUri: HlsSourceUri;
};

/**
 * When Twitch playlist proxy mode is on for live Watch, return proxy URLs in
 * fallback order ahead of the direct usher URI. Non-live and Kick are unchanged.
 */
export function playlistProxyPlaybackAttempts(input: {
  readonly direct: PlaylistProxyPlaybackAttempt;
  readonly preferences: TwitchPlaylistProxyPreferences | null | undefined;
  readonly target: WatchTarget;
}): readonly PlaylistProxyPlaybackAttempt[] {
  if (input.target.platform !== "twitch") return [input.direct];
  if (input.target.media) return [input.direct];
  if (!input.preferences?.enabled) return [input.direct];

  const attempts: PlaylistProxyPlaybackAttempt[] = [];
  for (const url of resolveTwitchPlaylistProxyAttemptUrls(
    input.preferences,
    input.target.channelName,
  )) {
    const sourceUri = asHttpsPlaybackSourceUri(url);
    if (!sourceUri) continue;
    attempts.push({
      requestHeaders: input.direct.requestHeaders,
      sourceUri,
    });
  }
  attempts.push(input.direct);
  return attempts;
}
