import type { TwitchPlaylistProxySource } from "./twitch-playlist-proxy";

export type PlaylistProxySourceStatus = "checking" | "online" | "offline";

export interface PlaylistProxyHealth {
  check(
    source: TwitchPlaylistProxySource,
    signal: AbortSignal,
  ): Promise<"online" | "offline">;
}
