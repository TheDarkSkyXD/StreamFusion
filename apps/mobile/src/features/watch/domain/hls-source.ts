import type { HlsSourceUri } from "../capabilities/watch";

export function asHlsSourceUri(value: string): HlsSourceUri | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    if (!url.pathname.toLowerCase().includes(".m3u8")) return undefined;
    return value as HlsSourceUri;
  } catch {
    return undefined;
  }
}
