/** A user-configured Twitch playlist proxy source. Array order is fallback order. */
export type TwitchPlaylistProxySource = {
  readonly id: string;
  /** HLS playlist template. `$channel` is replaced with the Twitch channel name. */
  readonly url: string;
  readonly enabled: boolean;
  /** Add source, audio-only, and low-latency query parameters to the playlist request. */
  readonly addQueryParams: boolean;
};

/**
 * Ordered playlist routing for Twitch live streams. Separate from HTTP
 * connectivity proxy (`features/connectivity`).
 */
export type TwitchPlaylistProxyPreferences = {
  readonly enabled: boolean;
  readonly sources: readonly TwitchPlaylistProxySource[];
};

export type TwitchPlaylistProxyView = {
  readonly enabled: boolean;
  readonly sources: readonly TwitchPlaylistProxySource[];
  readonly title: string;
  readonly detail: string;
};

export type TwitchPlaylistProxySession = {
  load(): Promise<TwitchPlaylistProxyView>;
  save(next: TwitchPlaylistProxyPreferences): Promise<TwitchPlaylistProxyView>;
  snapshot(): Promise<TwitchPlaylistProxyPreferences>;
};

export const TWITCH_PLAYLIST_PROXY_SETTING_KEY = "twitchPlaylistProxy.v1";

export function serializeTwitchPlaylistProxyPreferences(
  value: TwitchPlaylistProxyPreferences,
): string {
  return JSON.stringify({
    enabled: value.enabled,
    sources: value.sources,
    version: 1,
  });
}
