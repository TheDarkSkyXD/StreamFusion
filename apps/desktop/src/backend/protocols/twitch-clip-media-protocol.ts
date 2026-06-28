/**
 * twitch-clip-media:// custom protocol
 *
 * Twitch clip playback resolves to signed CloudFront MP4 URLs. Chromium media
 * requests from the renderer can fail those direct URLs even with webSecurity
 * disabled. This protocol keeps playback inside StreamFusion's custom player
 * while moving the CDN fetch to the main process, where we can supply stable
 * media headers and pass Range requests through.
 *
 * URL format: twitch-clip-media://media?u=<base64url-encoded-original-url>
 */

import { net, protocol } from "electron";

import { decodeTwitchClipMediaUrl, TWITCH_CLIP_MEDIA_SCHEME } from "./twitch-clip-media-url";

type FetchClipMedia = (
  url: string,
  init: { method: "GET"; headers: Record<string, string> }
) => Promise<Response>;

function errorResponse(status = 502): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isAllowedTwitchClipMediaUrl(originalUrl: string): boolean {
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol !== "https:") return false;

    return (
      parsed.hostname === "clips-media-assets2.twitch.tv" ||
      parsed.hostname.endsWith(".cloudfront.net")
    );
  } catch {
    return false;
  }
}

function copyHeader(headers: Headers, upstream: Response, name: string): void {
  const value = upstream.headers.get(name);
  if (value) headers.set(name, value);
}

export async function handleTwitchClipMediaRequest(
  request: Request,
  fetchClipMedia: FetchClipMedia = (url, init) => net.fetch(url, init)
): Promise<Response> {
  const url = new URL(request.url);
  const encodedUrl = url.searchParams.get("u");
  if (!encodedUrl) return errorResponse(400);

  const originalUrl = decodeTwitchClipMediaUrl(encodedUrl);
  if (!originalUrl || !isAllowedTwitchClipMediaUrl(originalUrl)) {
    return errorResponse(400);
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
      Origin: "https://clips.twitch.tv",
      Referer: "https://clips.twitch.tv/",
    };

    const range = request.headers.get("range");
    if (range) {
      headers.Range = range;
    }

    const upstream = await fetchClipMedia(originalUrl, {
      method: "GET",
      headers,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return errorResponse(upstream.status || 502);
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const responseHeaders = new Headers();
    copyHeader(responseHeaders, upstream, "Content-Type");
    copyHeader(responseHeaders, upstream, "Content-Range");
    copyHeader(responseHeaders, upstream, "Accept-Ranges");
    copyHeader(responseHeaders, upstream, "ETag");
    copyHeader(responseHeaders, upstream, "Last-Modified");
    if (!responseHeaders.has("Content-Type")) {
      responseHeaders.set("Content-Type", "video/mp4");
    }
    responseHeaders.set("Content-Length", bytes.byteLength.toString());
    responseHeaders.set("Cache-Control", "private, max-age=300");

    return new Response(bytes, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return errorResponse();
  }
}

export function registerTwitchClipMediaProtocol(): void {
  protocol.handle(TWITCH_CLIP_MEDIA_SCHEME, async (request) => {
    return handleTwitchClipMediaRequest(request);
  });
}
