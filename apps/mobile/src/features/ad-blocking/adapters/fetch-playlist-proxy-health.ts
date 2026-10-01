import type { PlaylistProxyHealth } from "../capabilities/playlist-proxy-health";
import {
  isTwitchPlaylistProxyTemplate,
  resolveTwitchPlaylistProxyPingUrl,
} from "../domain/twitch-playlist-proxy";

export function createFetchPlaylistProxyHealth(
  fetcher: typeof fetch,
): PlaylistProxyHealth {
  return {
    async check(source, signal) {
      if (!isTwitchPlaylistProxyTemplate(source.url)) return "offline";
      const url = resolveTwitchPlaylistProxyPingUrl(source);
      if (!url) return "offline";
      try {
        const response = await fetcher(url, { signal });
        if (!response.ok) return "offline";
        const body: unknown = await response.json();
        return typeof body === "object" &&
          body !== null &&
          "online" in body &&
          body.online === true
          ? "online"
          : "offline";
      } catch {
        return "offline";
      }
    },
  };
}
