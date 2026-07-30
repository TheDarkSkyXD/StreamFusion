const PUBLIC_MEDIA_HOST_SUFFIXES = [
  "cdn-perfprod.com",
  "cloudfront.net",
  "jtvnw.net",
  "kick.com",
  "live-video.net",
  "luminous.dev",
  "ttvnw.net",
  "twitch.tv",
  "twitchcdn.net",
] as const;

export const DEV_MEDIA_PROXY_PATH = "/__streamfusion-dev/media";
const MAX_TARGET_URL_LENGTH = 8 * 1024;
const MAX_RANGE_BYTES = 32 * 1024 * 1024;
const MAX_MEDIA_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 15_000;

export type DevMediaFetch = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
  }
) => Promise<Response>;

export type DevMediaKind = "media" | "kick-image" | "twitch-image";

function isDevMediaKind(value: string): value is DevMediaKind {
  return value === "media" || value === "kick-image" || value === "twitch-image";
}

function matchesPublicMediaHost(hostname: string): boolean {
  return PUBLIC_MEDIA_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

export function validateDevMediaTarget(value: string): URL | null {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return null;
  }

  if (
    target.protocol !== "https:" ||
    (target.port !== "" && target.port !== "443") ||
    target.username !== "" ||
    target.password !== "" ||
    !matchesPublicMediaHost(target.hostname)
  ) {
    return null;
  }

  return target;
}

export function buildDevMediaProxyUrl(target: string, kind: DevMediaKind = "media"): string {
  const query = new URLSearchParams({ u: target, kind });
  return `${DEV_MEDIA_PROXY_PATH}?${query.toString()}`;
}

function rewritePlaylistUri(value: string, sourceUrl: string): string {
  return buildDevMediaProxyUrl(new URL(value, sourceUrl).toString());
}

export function rewriteDevMediaPlaylist(playlist: string, sourceUrl: string): string {
  const newline = playlist.includes("\r\n") ? "\r\n" : "\n";
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (!trimmed.startsWith("#")) {
        const leading = line.slice(0, line.indexOf(trimmed));
        return `${leading}${rewritePlaylistUri(trimmed, sourceUrl)}`;
      }

      if (trimmed.startsWith("#EXT-X-TWITCH-PREFETCH:") || trimmed.startsWith("#EXT-X-PREFETCH:")) {
        const separator = line.indexOf(":");
        const value = line.slice(separator + 1).trim();
        return `${line.slice(0, separator + 1)}${rewritePlaylistUri(value, sourceUrl)}`;
      }

      return line.replace(
        /URI="([^"]+)"/g,
        (_match, value: string) => `URI="${rewritePlaylistUri(value, sourceUrl)}"`
      );
    })
    .join(newline);
}

function errorResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isHlsResponse(target: URL, response: Response): boolean {
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  return (
    target.pathname.toLowerCase().endsWith(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("vnd.apple")
  );
}

function isAllowedRange(value: string): boolean {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;

  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if (
    (start !== null && !Number.isSafeInteger(start)) ||
    (end !== null && !Number.isSafeInteger(end))
  ) {
    return false;
  }
  if (start !== null && end !== null) {
    return end >= start && end - start + 1 <= MAX_RANGE_BYTES;
  }
  if (start === null && end !== null) return end > 0 && end <= MAX_RANGE_BYTES;
  return true;
}

export async function handleDevMediaProxyRequest(
  request: Request,
  fetchUpstream: DevMediaFetch
): Promise<Response> {
  if (request.method !== "GET") return errorResponse(405);

  const relayUrl = new URL(request.url);
  if (relayUrl.pathname !== DEV_MEDIA_PROXY_PATH) return errorResponse(404);
  const rawTarget = relayUrl.searchParams.get("u");
  if (!rawTarget || rawTarget.length > MAX_TARGET_URL_LENGTH) return errorResponse(400);
  const rawKind = relayUrl.searchParams.get("kind") ?? "media";
  if (!isDevMediaKind(rawKind)) return errorResponse(400);
  const kind = rawKind;
  let target = validateDevMediaTarget(rawTarget);
  if (!target) return errorResponse(400);

  const headers: Record<string, string> = {};
  if (kind === "kick-image") {
    Object.assign(headers, {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Origin: "https://kick.com",
      Referer: "https://kick.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    });
  } else if (kind === "twitch-image") {
    Object.assign(headers, {
      Accept: "image/avif,image/webp,image/png,image/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    });
  }
  const range = request.headers.get("Range");
  if (range) {
    if (!isAllowedRange(range)) return errorResponse(416);
    headers.Range = range;
  }

  let upstream: Response | null = null;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    try {
      upstream = await fetchUpstream(target.toString(), {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return errorResponse(502);
    }

    if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
    if (redirectCount === MAX_REDIRECTS) return errorResponse(508);
    const location = upstream.headers.get("Location");
    if (!location) return errorResponse(502);
    const redirectedTarget = validateDevMediaTarget(new URL(location, target).toString());
    if (!redirectedTarget) return errorResponse(400);
    target = redirectedTarget;
  }

  if (!upstream) return errorResponse(502);
  if (!upstream.ok && upstream.status !== 206) return errorResponse(upstream.status || 502);

  const isPlaylist = isHlsResponse(target, upstream);
  const maxResponseBytes = isPlaylist ? MAX_PLAYLIST_BYTES : MAX_MEDIA_RESPONSE_BYTES;
  const declaredLength = upstream.headers.get("Content-Length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maxResponseBytes
    ) {
      return errorResponse(413);
    }
  }

  if (isPlaylist) {
    const playlist = rewriteDevMediaPlaylist(await upstream.text(), target.toString());
    return new Response(playlist, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/vnd.apple.mpegurl",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const responseHeaders = new Headers({
    "Cache-Control": kind === "media" ? "private, max-age=300" : "public, max-age=3600",
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of [
    "Accept-Ranges",
    "Content-Length",
    "Content-Range",
    "ETag",
    "Last-Modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
