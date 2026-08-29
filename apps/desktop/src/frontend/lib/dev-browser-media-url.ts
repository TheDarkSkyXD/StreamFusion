export const DEV_BROWSER_MEDIA_PATH = "/__streamfusion-dev/media";

export type DevBrowserMediaKind = "media" | "kick-image" | "twitch-image";

export function buildDevBrowserMediaUrl(
  upstreamUrl: string,
  kind: DevBrowserMediaKind = "media"
): string {
  return `${DEV_BROWSER_MEDIA_PATH}?${new URLSearchParams({ u: upstreamUrl, kind }).toString()}`;
}

function decodeBase64Url(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0))
    );
  } catch {
    return null;
  }
}

export function rewriteDevBrowserPlaybackUrl(value: string): string {
  if (value.startsWith("twitch-clip-media://")) {
    const encoded = new URL(value).searchParams.get("u");
    const decoded = encoded ? decodeBase64Url(encoded) : null;
    return decoded ? buildDevBrowserMediaUrl(decoded) : value;
  }
  return value.startsWith("https://") ? buildDevBrowserMediaUrl(value) : value;
}

export function rewriteDevBrowserPlaybackValue(value: unknown): unknown {
  if (typeof value === "string") return rewriteDevBrowserPlaybackUrl(value);
  if (Array.isArray(value)) return value.map(rewriteDevBrowserPlaybackValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      rewriteDevBrowserPlaybackValue(item),
    ])
  );
}
