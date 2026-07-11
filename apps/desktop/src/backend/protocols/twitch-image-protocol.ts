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

function sniffImageContentType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
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
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
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
  return null;
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

      const contentType = upstream.headers.get("Content-Type") || "";
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      const sniffedContentType = sniffImageContentType(bytes);
      const effectiveContentType = contentType.startsWith("image/")
        ? contentType
        : sniffedContentType;
      // Pass-through guard: Twitch's 403 responses come back with
      // Content-Type: text/html. Refuse to forward anything that isn't
      // declared as an image or recognizable from its magic bytes. Some valid
      // Twitch avatars are served as binary/octet-stream.
      if (!effectiveContentType) {
        return placeholderResponse();
      }

      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": effectiveContentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return placeholderResponse();
    }
  });
}
