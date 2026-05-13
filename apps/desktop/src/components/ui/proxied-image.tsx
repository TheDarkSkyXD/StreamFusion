/**
 * ProxiedImage Component
 *
 * Renders an <img> for remote images. For Kick CDN URLs (which require special
 * Referer/Origin headers to bypass hotlinking protection), the src is rewritten
 * to a kick-image://image?u=<base64url> URL handled by the custom protocol in
 * the main process. That lets Chromium use its native disk + decoded-bitmap
 * cache instead of holding a multi-MB base64 data URL per visible image in
 * renderer JS memory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const KICK_IMAGE_SCHEME = "kick-image";

// Domains that require proxying through kick-image:// (Referer/Origin needed).
const PROXY_REQUIRED_DOMAINS: string[] = ["files.kick.com", "images.kick.com"];

// Additional URL patterns that require proxying (checked against full URL)
const PROXY_REQUIRED_PATTERNS: RegExp[] = [
  /^https?:\/\/(www\.)?kick\.com\/img\//i, // kick.com/img/... URLs from official API
];

function needsProxy(url: string): boolean {
  try {
    const parsed = new URL(url);

    const domainMatch = PROXY_REQUIRED_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
    if (domainMatch) return true;

    return PROXY_REQUIRED_PATTERNS.some((pattern) => pattern.test(url));
  } catch {
    return false;
  }
}

function toBase64Url(value: string): string {
  // btoa accepts only Latin-1 bytes; encode as UTF-8 first so Kick CDN URLs
  // with non-ASCII characters round-trip safely.
  const utf8 = String.fromCharCode(...new TextEncoder().encode(value));
  return btoa(utf8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function resolveSrc(src: string | undefined | null): string | null {
  if (!src || src.trim() === "") return null;
  if (src.startsWith("data:")) return src;
  if (!src.startsWith("http")) return null;
  if (needsProxy(src)) {
    return `${KICK_IMAGE_SCHEME}://image?u=${toBase64Url(src)}`;
  }
  return src;
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
  const [hasError, setHasError] = useState(false);

  // Reset load state when the underlying src actually changes. A bare
  // useEffect([resolvedSrc]) would also fire on initial mount and override the
  // ref-callback's cache-hit detection below, leaving cached images stuck on
  // the animate-pulse placeholder forever (no fresh onLoad would fire to
  // recover, since the image is already complete).
  useEffect(() => {
    if (seenSrcRef.current !== null && seenSrcRef.current !== resolvedSrc) {
      setIsLoaded(false);
      setHasError(false);
    }
    seenSrcRef.current = resolvedSrc;
  }, [resolvedSrc]);

  // Cache hits can fire <img>'s load event before React attaches the handler,
  // leaving isLoaded stuck at false. Detect via the ref callback (which runs
  // during commit) so the placeholder doesn't flash for cached images.
  const setImgRef = useCallback((el: HTMLImageElement | null) => {
    imgRef.current = el;
    if (el?.complete && el.naturalWidth > 0) {
      setIsLoaded(true);
    }
  }, []);

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
      onLoad={() => setIsLoaded(true)}
      onError={() => {
        setHasError(true);
        onProxyError?.();
      }}
    />
  );
}
