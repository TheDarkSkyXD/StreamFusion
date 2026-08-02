/**
 * twitch-image:// custom protocol
 *
 * Companion to kick-image://, but the problem it solves is different. Twitch's
 * static-cdn.jtvnw.net serves per-user profile-image objects that occasionally
 * return 403 Forbidden + Content-Type: text/html for specific user assets
 * (twitch.tv's own UI hits net::ERR_BLOCKED_BY_ORB on the same paths — it's a
 * CDN-side per-user issue, not anything an HTTP header can change). Letting
 * those reach <img> means a "Failed to load resource" line per render in the
 * renderer DevTools console for every broken avatar.
 *
 * This protocol fetches the upstream URL from the main process and returns a
 * 1×1 transparent PNG on any non-2xx response, so onLoad always fires in the
 * renderer and the network failure never surfaces to the DevTools console.
 * The renderer detects the placeholder via naturalWidth === 1 and switches to
 * the fallback initial.
 *
 * URL format: twitch-image://image?u=<base64url-encoded-original-url>
 */

import { net, protocol } from "electron";

import { imageByteCache } from "./image-byte-cache";

export const TWITCH_IMAGE_SCHEME = "twitch-image";

// 1×1 fully-transparent PNG, 67 bytes. The renderer treats naturalWidth === 1
// as "upstream failed, paint the fallback." Twitch never serves 1×1 avatars,
// so this is a reliable in-band signal.
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Build a twitch-image:// URL from a Twitch CDN URL. Run this in the renderer
 * when setting <img src> for Twitch profile images.
 */
function buildTwitchImageUrl(originalUrl: string): string {
  const b64url = Buffer.from(originalUrl, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${TWITCH_IMAGE_SCHEME}://image?u=${b64url}`;
}

function decodeOriginalUrl(b64url: string): string | null {
  try {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function placeholderResponse(): Response {
  return new Response(new Uint8Array(PLACEHOLDER_PNG), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // Don't let Chromium cache the placeholder. If Twitch's CDN starts
      // serving the asset again, the next request should actually try the
      // upstream rather than reuse the 1×1 indefinitely.
      "Cache-Control": "no-store",
    },
  });
}

function detectImageContentType(bytes: Uint8Array, declaredContentType: string): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }

  return declaredContentType.startsWith("image/") ? declaredContentType : null;
}

function imageResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function registerTwitchImageProtocol(): void {
  protocol.handle(TWITCH_IMAGE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const u = url.searchParams.get("u");
    if (!u) return placeholderResponse();

    const originalUrl = decodeOriginalUrl(u);
    if (!originalUrl || !/^https?:\/\//i.test(originalUrl)) {
      return placeholderResponse();
    }

    const cached = imageByteCache.get(originalUrl);
    if (cached) return imageResponse(cached.bytes, cached.contentType);

    try {
      const upstream = await net.fetch(originalUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/png,image/*;q=0.8",
        },
      });

      if (!upstream.ok) return placeholderResponse();

      const declaredContentType = upstream.headers.get("Content-Type") || "";
      // Twitch can label valid avatar bytes as binary/octet-stream. Prefer a
      // recognized byte signature, but retain a declared image type for
      // formats without one so non-image responses still become placeholders.
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      const contentType = detectImageContentType(bytes, declaredContentType);
      if (!contentType) return placeholderResponse();

      imageByteCache.set(originalUrl, bytes, contentType);
      return imageResponse(bytes, contentType);
    } catch {
      return placeholderResponse();
    }
  });
}
