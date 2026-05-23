/**
 * ProxiedImage Component
 *
 * Renders an <img> for remote images. Two custom protocols handle CDNs that
 * the renderer can't reach cleanly:
 *
 *  - kick-image:// — Kick CDN needs Referer/Origin spoofing to bypass
 *    hotlinking protection. The main process attaches the right headers.
 *  - twitch-image:// — Twitch's static-cdn.jtvnw.net returns 403 + text/html
 *    for specific per-user profile-image objects (twitch.tv's own UI also
 *    fails on the same paths — it's CDN-side per-user breakage). The main
 *    process swallows those failures and returns a 1×1 transparent PNG, so
 *    no 403 ever reaches the renderer's DevTools network log. The 1×1
 *    placeholder is detected here via naturalWidth === 1 and routed to the
 *    fallback initial.
 *
 * Both protocols let Chromium use its native disk + decoded-bitmap cache
 * instead of holding multi-MB base64 data URLs in renderer JS memory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const KICK_IMAGE_SCHEME = "kick-image";
const TWITCH_IMAGE_SCHEME = "twitch-image";

// Session-level set of URLs that have already 403'd / errored. Used to skip
// the network request on subsequent renders so the console doesn't fill up
// with the same "GET ... 403 (Forbidden)" line every time the parent
// re-renders. In-memory only — forgotten on app restart, so if the asset
// recovers we'll pick it up on the next launch.
const brokenUrls = new Set<string>();

/** Test-only escape hatch — production code should never need this. */
export function _resetProxiedImageBrokenUrls(): void {
  brokenUrls.clear();
}

// Domains that route through kick-image:// (Referer/Origin spoofing).
const KICK_PROXY_DOMAINS: string[] = ["files.kick.com", "images.kick.com"];
const KICK_PROXY_PATTERNS: RegExp[] = [
  /^https?:\/\/(www\.)?kick\.com\/img\//i, // kick.com/img/... URLs from official API
];

// URL patterns that route through twitch-image:// (swallow per-user 403s on
// Twitch's CDN). Kept narrow to profile_image objects only — emotes and live
// thumbnails don't have the same breakage and routing them through the main
// process would add latency to chat rendering.
const TWITCH_PROXY_PATTERNS: RegExp[] = [
  /^https:\/\/static-cdn\.jtvnw\.net\/jtv_user_pictures\//i,
];

type ProxyScheme = typeof KICK_IMAGE_SCHEME | typeof TWITCH_IMAGE_SCHEME;

function chooseProxy(url: string): ProxyScheme | null {
  try {
    const parsed = new URL(url);
    const kickDomainHit = KICK_PROXY_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
    if (kickDomainHit) return KICK_IMAGE_SCHEME;
    if (KICK_PROXY_PATTERNS.some((p) => p.test(url))) return KICK_IMAGE_SCHEME;
    if (TWITCH_PROXY_PATTERNS.some((p) => p.test(url))) return TWITCH_IMAGE_SCHEME;
    return null;
  } catch {
    return null;
  }
}

function toBase64Url(value: string): string {
  // btoa accepts only Latin-1 bytes; encode as UTF-8 first so CDN URLs with
  // non-ASCII characters round-trip safely.
  const utf8 = String.fromCharCode(...new TextEncoder().encode(value));
  return btoa(utf8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function resolveSrc(src: string | undefined | null): string | null {
  if (!src || src.trim() === "") return null;
  if (src.startsWith("data:")) return src;
  if (!src.startsWith("http")) return null;
  const scheme = chooseProxy(src);
  if (scheme) {
    return `${scheme}://image?u=${toBase64Url(src)}`;
  }
  return src;
}

// Treat this <img> as a proxy placeholder if the protocol handler returned
// the 1×1 transparent PNG (its in-band signal that the upstream failed).
// Only matters for proxied URLs — direct CDN images can legitimately be very
// small and we don't want to false-fallback them.
function isProxyPlaceholder(el: HTMLImageElement, resolvedSrc: string | null): boolean {
  if (!resolvedSrc) return false;
  if (!resolvedSrc.startsWith(`${TWITCH_IMAGE_SCHEME}://`)) return false;
  return el.naturalWidth === 1 && el.naturalHeight === 1;
}

interface ProxiedImageProps {
  src: string | undefined | null;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  fallbackClassName?: string;
  /** Kept for backward compatibility; placeholder is now drawn on the <img>. */
  skeletonClassName?: string;
  /**
   * Native lazy loading attribute. Defaults to "lazy" for off-screen images.
   * Use "eager" for above-the-fold images that should load immediately.
   */
  loading?: "lazy" | "eager";
  /**
   * Intrinsic image dimensions. Recommended for grid cards/avatars so Chromium
   * can reserve layout space (no CLS) and defer offscreen decode.
   */
  width?: number;
  height?: number;
  /**
   * Fires when the image fails to load. Use to hide host UI for permanently
   * broken URLs (e.g. purged Kick VOD thumbnails).
   */
  onProxyError?: () => void;
}

export function ProxiedImage({
  src,
  alt,
  className = "",
  fallback,
  fallbackClassName = "",
  loading = "lazy",
  width,
  height,
  onProxyError,
}: ProxiedImageProps) {
  const resolvedSrc = useMemo(() => resolveSrc(src), [src]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const seenSrcRef = useRef<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Seed hasError from the session-level skip-list so a URL that 403'd earlier
  // in this session goes straight to the fallback path without re-issuing a
  // request the browser would log to the console.
  const [hasError, setHasError] = useState(() =>
    resolvedSrc !== null && brokenUrls.has(resolvedSrc)
  );

  // Reset load state when the underlying src actually changes. A bare
  // useEffect([resolvedSrc]) would also fire on initial mount and override the
  // ref-callback's cache-hit detection below, leaving cached images stuck on
  // the animate-pulse placeholder forever (no fresh onLoad would fire to
  // recover, since the image is already complete).
  useEffect(() => {
    if (seenSrcRef.current !== null && seenSrcRef.current !== resolvedSrc) {
      setIsLoaded(false);
      // Re-seed against the skip-list on src change so a previously-broken
      // URL stays broken without a doomed retry, while a fresh URL starts
      // clean.
      setHasError(resolvedSrc !== null && brokenUrls.has(resolvedSrc));
    }
    seenSrcRef.current = resolvedSrc;
  }, [resolvedSrc]);

  // Cache hits can fire <img>'s load event before React attaches the handler,
  // leaving isLoaded stuck at false. Detect via the ref callback (which runs
  // during commit) so the placeholder doesn't flash for cached images.
  const setImgRef = useCallback(
    (el: HTMLImageElement | null) => {
      imgRef.current = el;
      if (el?.complete && el.naturalWidth > 0) {
        if (isProxyPlaceholder(el, resolvedSrc)) {
          if (resolvedSrc) brokenUrls.add(resolvedSrc);
          setHasError(true);
          onProxyError?.();
          return;
        }
        setIsLoaded(true);
      }
    },
    [resolvedSrc, onProxyError]
  );

  if (!resolvedSrc || hasError) {
    if (fallback) return <>{fallback}</>;
    const initial = alt ? alt.charAt(0).toUpperCase() : "?";
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-secondary text-lg font-bold",
          fallbackClassName || className
        )}
      >
        {initial}
      </div>
    );
  }

  // Important: do NOT hide the <img> with display:none / `hidden` while it
  // is loading. The browser's lazy-load IntersectionObserver needs the img
  // to occupy layout, otherwise it never intersects the viewport, never
  // loads, and onLoad never fires — leaving every off-screen avatar /
  // thumbnail stuck on a placeholder. Instead we paint a pulsing placeholder
  // background ON the <img> itself; the image content draws over it once
  // the network response arrives.
  return (
    <img
      ref={setImgRef}
      src={resolvedSrc}
      alt={alt}
      className={cn(
        !isLoaded && "animate-pulse bg-[var(--color-background-elevated)]",
        className
      )}
      loading={loading}
      decoding="async"
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
      onLoad={(e) => {
        if (isProxyPlaceholder(e.currentTarget, resolvedSrc)) {
          if (resolvedSrc) brokenUrls.add(resolvedSrc);
          setHasError(true);
          onProxyError?.();
          return;
        }
        setIsLoaded(true);
      }}
      onError={() => {
        if (resolvedSrc) brokenUrls.add(resolvedSrc);
        setHasError(true);
        onProxyError?.();
      }}
    />
  );
}
