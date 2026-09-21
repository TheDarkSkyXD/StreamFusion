import type { HlsSourceUri } from "../capabilities/watch";

export function asHlsSourceUri(value: string): HlsSourceUri | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    const path = url.pathname.toLowerCase();
    if (!path.includes(".m3u8") && !path.endsWith(".mp4")) return undefined;
    return value as HlsSourceUri;
  } catch {
    return undefined;
  }
}

/** Playlist-proxy templates often omit `.m3u8`; ExoPlayer follows redirects. */
export function asHttpsPlaybackSourceUri(value: string): HlsSourceUri | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    return value as HlsSourceUri;
  } catch {
    return undefined;
  }
}
