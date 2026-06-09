/**
 * kick-image:// custom protocol
 *
 * Replaces the IPC base64 image-proxy with a streaming protocol handler that
 * lets Chromium use its native image cache (disk + decoded-bitmap LRU) instead
 * of holding a multi-MB base64 data URL per visible image in the renderer.
 *
 * URL format: kick-image://image?u=<base64url-encoded-original-url>
 *
 * The renderer encodes a Kick CDN URL and sets it on <img src>. The browser
 * fetches via this protocol, which calls kickClient.fetchImageBytes() with the
 * correct Referer/Origin/User-Agent headers to bypass Kick's hotlinking
 * protection.
 */

import { protocol } from "electron";

import { kickClient } from "../api/platforms/kick/kick-client";

export const KICK_IMAGE_SCHEME = "kick-image";

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function placeholderResponse(): Response {
  return new Response(new Uint8Array(PLACEHOLDER_PNG), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Build a kick-image:// URL from a Kick CDN URL. Run this in the renderer when
 * setting <img src> for Kick-hosted images.
 */
function buildKickImageUrl(originalUrl: string): string {
  const b64url = Buffer.from(originalUrl, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${KICK_IMAGE_SCHEME}://image?u=${b64url}`;
}

function decodeOriginalUrl(b64url: string): string | null {
  try {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export function registerKickImageProtocol(): void {
  protocol.handle(KICK_IMAGE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const u = url.searchParams.get("u");
    if (!u) {
      return placeholderResponse();
    }

    const originalUrl = decodeOriginalUrl(u);
    if (!originalUrl || !/^https?:\/\//i.test(originalUrl)) {
      return placeholderResponse();
    }

    const result = await kickClient.fetchImageBytes(originalUrl);
    if (!result) {
      return placeholderResponse();
    }

    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        // Let Chromium cache for 1h (thumbnails change rarely) and reuse the
        // decoded bitmap across grid mounts.
        "Cache-Control": "public, max-age=3600",
      },
    });
  });
}
