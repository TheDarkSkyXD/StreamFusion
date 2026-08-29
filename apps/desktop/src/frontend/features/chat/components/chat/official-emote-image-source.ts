import type React from "react";
import { useCallback, useState } from "react";

const SEVEN_TV_PRIMARY_HOST = "cdn.7tv.app";
const SEVEN_TV_IPV4_EDGE_HOST = "ipv4-1.eu.cdn.7tv.app";
const LOADED_SOURCE_CACHE_LIMIT = 500;
const loadedSourceCache = new Map<string, string>();

interface ImageAttempt {
  originalUrl: string;
  sourceUrl: string;
  status: "loading" | "loaded" | "failed";
  retried: boolean;
}

function createInitialAttempt(originalUrl: string): ImageAttempt {
  const cachedSourceUrl = loadedSourceCache.get(originalUrl);
  return {
    originalUrl,
    sourceUrl: cachedSourceUrl ?? originalUrl,
    status: cachedSourceUrl ? "loaded" : "loading",
    retried: cachedSourceUrl !== undefined && cachedSourceUrl !== originalUrl,
  };
}

export function getSevenTvIpv4FallbackUrl(sourceUrl: string): string | null {
  try {
    const parsed = new URL(sourceUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.toLowerCase() !== SEVEN_TV_PRIMARY_HOST ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    parsed.hostname = SEVEN_TV_IPV4_EDGE_HOST;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getLoadedEmoteImageSource(originalUrl: string): string | undefined {
  return loadedSourceCache.get(originalUrl);
}

function rememberLoadedEmoteImageSource(originalUrl: string, loadedSourceUrl: string): void {
  loadedSourceCache.set(originalUrl, loadedSourceUrl);
  if (loadedSourceCache.size <= LOADED_SOURCE_CACHE_LIMIT) return;
  const oldestOriginalUrl = loadedSourceCache.keys().next().value;
  if (typeof oldestOriginalUrl === "string") loadedSourceCache.delete(oldestOriginalUrl);
}

export function useOfficialEmoteImageSource(originalUrl: string) {
  const [attempt, setAttempt] = useState<ImageAttempt>(() => createInitialAttempt(originalUrl));
  const activeAttempt =
    attempt.originalUrl === originalUrl ? attempt : createInitialAttempt(originalUrl);

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const loadedSourceUrl = event.currentTarget.getAttribute("src");
      if (loadedSourceUrl !== activeAttempt.sourceUrl) return;
      rememberLoadedEmoteImageSource(originalUrl, loadedSourceUrl);
      setAttempt({ ...activeAttempt, status: "loaded" });
    },
    [activeAttempt, originalUrl]
  );

  const handleError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const failedSourceUrl = event.currentTarget.getAttribute("src");
      if (failedSourceUrl !== activeAttempt.sourceUrl) return;
      const fallbackUrl = activeAttempt.retried
        ? null
        : getSevenTvIpv4FallbackUrl(activeAttempt.originalUrl);
      if (fallbackUrl) {
        setAttempt({
          ...activeAttempt,
          sourceUrl: fallbackUrl,
          status: "loading",
          retried: true,
        });
        return;
      }
      setAttempt({ ...activeAttempt, status: "failed" });
    },
    [activeAttempt]
  );

  return {
    sourceUrl: activeAttempt.sourceUrl,
    loaded: activeAttempt.status === "loaded",
    failed: activeAttempt.status === "failed",
    handleLoad,
    handleError,
  };
}
