export const TWITCH_CLIP_MEDIA_SCHEME = "twitch-clip-media";

export function buildTwitchClipMediaUrl(originalUrl: string): string {
  const encoded = Buffer.from(originalUrl, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${TWITCH_CLIP_MEDIA_SCHEME}://media?u=${encoded}`;
}

export function decodeTwitchClipMediaUrl(encoded: string): string | null {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}
